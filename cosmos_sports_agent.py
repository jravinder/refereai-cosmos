"""
Cosmos Sports Agent — Agentic Pipeline Orchestrator

The "Video Analytics AI Agent" that ties Cosmos Reason 2 to the
RefereAI scoring engine. Implements the agentic loop:

1. Receive frames from camera/video pipeline
2. Sample at configurable interval
3. Send to Cosmos Reason 2 with sport-specific prompts
4. Parse <think>/<answer> into GameEvent
5. Feed into ScoringEngine → WebSocket broadcast → mobile app
6. Feed current score context back into next prompt (agentic loop)
"""
import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List, Callable

from ai.cosmos_reason2 import CosmosReason2Backend, CosmosReasoningResult, parse_cosmos_response
from ai.cosmos_prompts import (
    get_system_prompt,
    get_scene_prompt,
    get_physical_reasoning_prompt,
    get_commentary_prompt,
    SUPPORTED_SPORTS,
)
from ai.vision_commentary import VisionConfig, VisionProvider, VisionBackend
from scoring.engine import ScoringEngine, GameEvent, EventType

logger = logging.getLogger(__name__)


# Mapping from Cosmos scene analysis events → EventType
EVENT_MAP: Dict[str, EventType] = {
    # Cricket
    "boundary_4": EventType.BOUNDARY_4,
    "boundary_6": EventType.BOUNDARY_6,
    "wicket": EventType.WICKET,
    "dot_ball": EventType.DOT_BALL,
    "run": EventType.RUN,
    "wide": EventType.WIDE,
    "no_ball": EventType.NO_BALL,
    # Tennis / Racket
    "point": EventType.POINT,
    "ace": EventType.ACE,
    "double_fault": EventType.DOUBLE_FAULT,
    "winner": EventType.WINNER,
    "unforced_error": EventType.UNFORCED_ERROR,
    "in": EventType.IN,
    "out": EventType.OUT,
    "let": EventType.LET,
    # Aliases
    "fault": EventType.DOUBLE_FAULT,
    "kitchen_violation": EventType.POINT,
}

# Minimum confidence threshold for auto-scoring
DEFAULT_CONFIDENCE_THRESHOLD = 0.7


@dataclass
class PipelineConfig:
    """Configuration for the Cosmos scoring pipeline."""
    sport: str = "cricket"
    frame_interval: float = 2.0       # Seconds between analyses
    confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD
    auto_score: bool = True            # Automatically feed events to scorer
    enable_commentary: bool = True     # Generate commentary after scoring
    enable_physics: bool = False       # Run physics analysis (slower, richer)
    max_tokens: int = 1024
    temperature: float = 0.3           # Lower temp for scoring accuracy


@dataclass
class PipelineState:
    """Runtime state of the pipeline."""
    is_running: bool = False
    frames_analyzed: int = 0
    events_detected: int = 0
    events_scored: int = 0
    last_analysis_ms: float = 0.0
    last_event: Optional[str] = None
    last_thinking: Optional[str] = None
    last_answer: Optional[str] = None
    started_at: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        uptime = time.time() - self.started_at if self.started_at else 0
        return {
            "is_running": self.is_running,
            "frames_analyzed": self.frames_analyzed,
            "events_detected": self.events_detected,
            "events_scored": self.events_scored,
            "last_analysis_ms": round(self.last_analysis_ms, 1),
            "last_event": self.last_event,
            "last_thinking": self.last_thinking,
            "last_answer": self.last_answer,
            "uptime_seconds": round(uptime, 1),
        }


class CosmosScorePipeline:
    """
    Agentic pipeline: Camera → Cosmos Reason 2 → ScoringEngine → Mobile App

    Usage:
        pipeline = CosmosScorePipeline(
            config=PipelineConfig(sport="cricket"),
            scorer=CricketScorer(overs=5),
        )
        pipeline.on_event(lambda e: print(e))
        pipeline.on_reasoning(lambda r: print(r.thinking))

        # Feed frames from camera
        await pipeline.process_frame(frame_base64)

        # Or run continuous loop with a frame source
        await pipeline.run(frame_source_callback)
    """

    def __init__(
        self,
        config: Optional[PipelineConfig] = None,
        scorer: Optional[ScoringEngine] = None,
    ):
        self.config = config or PipelineConfig()
        self.scorer = scorer
        self.state = PipelineState()

        # Initialize Cosmos backend
        vision_config = VisionConfig(
            provider=VisionProvider.COSMOS_REASON2,
            model="nvidia/cosmos-reason2-8b",
            sport=self.config.sport,
            max_tokens=self.config.max_tokens,
            temperature=self.config.temperature,
        )
        self._backend = CosmosReason2Backend(vision_config)

        # Callbacks
        self._event_callbacks: List[Callable[[GameEvent, CosmosReasoningResult], None]] = []
        self._reasoning_callbacks: List[Callable[[CosmosReasoningResult], None]] = []
        self._commentary_callbacks: List[Callable[[str, CosmosReasoningResult], None]] = []

    def on_event(self, callback: Callable[[GameEvent, CosmosReasoningResult], None]):
        """Register callback for detected scoring events."""
        self._event_callbacks.append(callback)

    def on_reasoning(self, callback: Callable[[CosmosReasoningResult], None]):
        """Register callback for raw reasoning results (for UI display)."""
        self._reasoning_callbacks.append(callback)

    def on_commentary(self, callback: Callable[[str, CosmosReasoningResult], None]):
        """Register callback for generated commentary."""
        self._commentary_callbacks.append(callback)

    def _get_score_context(self) -> str:
        """Get current score as context for the next prompt."""
        if not self.scorer:
            return "No active game"
        try:
            score = self.scorer.get_score()
            return json.dumps(score, indent=2, default=str)
        except Exception:
            return "Score unavailable"

    def _parse_event_from_answer(self, answer: str) -> Optional[GameEvent]:
        """
        Parse a GameEvent from the Cosmos answer.

        The answer should contain a JSON object with an "event" field.
        """
        try:
            # Try to extract JSON from the answer
            # Look for JSON object in the text
            json_match = None
            brace_depth = 0
            start_idx = None

            for i, ch in enumerate(answer):
                if ch == '{':
                    if brace_depth == 0:
                        start_idx = i
                    brace_depth += 1
                elif ch == '}':
                    brace_depth -= 1
                    if brace_depth == 0 and start_idx is not None:
                        json_match = answer[start_idx:i + 1]
                        break

            if not json_match:
                return None

            data = json.loads(json_match)
            event_str = data.get("event", "none").lower().strip()

            if event_str == "none" or event_str not in EVENT_MAP:
                return None

            event_type = EVENT_MAP[event_str]
            confidence = float(data.get("confidence", 0.5))

            # Check confidence threshold
            if confidence < self.config.confidence_threshold:
                logger.info(
                    "Event %s below threshold (%.2f < %.2f)",
                    event_str, confidence, self.config.confidence_threshold,
                )
                return None

            player = data.get("player")
            if player is not None:
                player = int(player)

            return GameEvent(
                event_type=event_type,
                player=player,
                confidence=confidence,
                metadata={
                    "source": "cosmos_reason2",
                    "description": data.get("description", ""),
                    "phase": data.get("phase", ""),
                },
            )

        except (json.JSONDecodeError, ValueError, KeyError) as e:
            logger.debug("Could not parse event from answer: %s", e)
            return None

    async def process_frame(self, frame_base64: str) -> Dict[str, Any]:
        """
        Process a single frame through the full pipeline.

        Returns dict with analysis results, detected event, and score update.
        """
        self.state.frames_analyzed += 1
        result_data: Dict[str, Any] = {
            "frame_number": self.state.frames_analyzed,
        }

        # Step 1: Scene understanding (detect events)
        system_prompt = get_system_prompt(self.config.sport)
        scene_prompt = get_scene_prompt(self.config.sport)

        scene_result = await self._backend.analyze_frame_with_reasoning(
            frame_base64, scene_prompt, system_prompt
        )

        self.state.last_analysis_ms = scene_result.latency_ms
        self.state.last_thinking = scene_result.thinking
        self.state.last_answer = scene_result.answer

        result_data["scene"] = scene_result.to_dict()

        # Notify reasoning callbacks
        for cb in self._reasoning_callbacks:
            try:
                cb(scene_result)
            except Exception as e:
                logger.error("Reasoning callback error: %s", e)

        # Step 2: Parse event from scene analysis
        event = self._parse_event_from_answer(scene_result.answer)

        if event:
            self.state.events_detected += 1
            self.state.last_event = event.event_type.value
            result_data["event"] = event.to_dict()

            # Notify event callbacks
            for cb in self._event_callbacks:
                try:
                    cb(event, scene_result)
                except Exception as e:
                    logger.error("Event callback error: %s", e)

            # Step 3: Feed to scoring engine
            if self.config.auto_score and self.scorer:
                try:
                    score_result = self.scorer.process_event(event)
                    self.state.events_scored += 1
                    result_data["score"] = score_result
                except Exception as e:
                    logger.error("Scoring error: %s", e)
                    result_data["score_error"] = str(e)

        # Step 4: Generate commentary (if enabled and event detected)
        if self.config.enable_commentary and event:
            score_ctx = self._get_score_context()
            commentary_prompt = get_commentary_prompt(self.config.sport, score_ctx)

            commentary_result = await self._backend.analyze_frame_with_reasoning(
                frame_base64, commentary_prompt, system_prompt
            )

            commentary = commentary_result.answer
            result_data["commentary"] = commentary
            result_data["commentary_reasoning"] = commentary_result.thinking

            for cb in self._commentary_callbacks:
                try:
                    cb(commentary, commentary_result)
                except Exception as e:
                    logger.error("Commentary callback error: %s", e)

        # Step 5: Physics analysis (if enabled)
        if self.config.enable_physics:
            physics_prompt = get_physical_reasoning_prompt(self.config.sport)
            physics_result = await self._backend.analyze_frame_with_reasoning(
                frame_base64, physics_prompt, system_prompt
            )
            result_data["physics"] = physics_result.to_dict()

        return result_data

    async def run(
        self,
        frame_source: Callable[[], Optional[str]],
        stop_event: Optional[asyncio.Event] = None,
    ):
        """
        Run the continuous analysis loop.

        Args:
            frame_source: Callable that returns base64 frame or None
            stop_event: Optional asyncio.Event to signal stop
        """
        self.state.is_running = True
        self.state.started_at = time.time()

        logger.info(
            "CosmosScorePipeline started: sport=%s, interval=%.1fs",
            self.config.sport, self.config.frame_interval,
        )

        try:
            while self.state.is_running:
                if stop_event and stop_event.is_set():
                    break

                frame = frame_source()
                if frame:
                    try:
                        await self.process_frame(frame)
                    except Exception as e:
                        logger.error("Pipeline frame error: %s", e)

                await asyncio.sleep(self.config.frame_interval)
        finally:
            self.state.is_running = False
            await self._backend.close()

    def stop(self):
        """Stop the pipeline."""
        self.state.is_running = False

    def get_state(self) -> Dict[str, Any]:
        """Get pipeline state + backend stats."""
        return {
            "pipeline": self.state.to_dict(),
            "backend": self._backend.get_stats(),
            "config": {
                "sport": self.config.sport,
                "frame_interval": self.config.frame_interval,
                "confidence_threshold": self.config.confidence_threshold,
                "auto_score": self.config.auto_score,
                "enable_commentary": self.config.enable_commentary,
                "enable_physics": self.config.enable_physics,
            },
        }
