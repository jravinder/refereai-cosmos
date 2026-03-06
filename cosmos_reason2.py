"""
Cosmos Reason 2 Vision Backend for RefereAI

NVIDIA's physical reasoning VLM — chain-of-thought reasoning about
ball trajectories, player movements, and scoring decisions.

Supports:
- HuggingFace Transformers on Jetson AGX Orin (primary)
- vLLM serving
- LiteLLM proxy for API key management and usage tracking

All endpoints use OpenAI-compatible /v1/chat/completions format.
"""
import asyncio
import base64
import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List, Tuple

try:
    import httpx
    _HAS_HTTPX = True
except ImportError:
    _HAS_HTTPX = False
    httpx = None

# Try importing optional dependencies, fall back to
# standalone-compatible base classes defined here.
try:
    from ai.vision_commentary import VisionBackend, VisionConfig
except ImportError:
    try:
        from vision_commentary import VisionBackend, VisionConfig
    except ImportError:
        # Standalone mode — define minimal base classes so this module
        # Standalone mode — define minimal base classes.
        from abc import ABC, abstractmethod
        from enum import Enum

        class VisionProvider(str, Enum):
            """Supported vision backends."""
            COSMOS_REASON2 = "cosmos_reason2"

        @dataclass
        class VisionConfig:
            """Configuration for a vision backend."""
            provider: str = "cosmos_reason2"
            endpoint: str = ""
            model: str = ""
            sport: str = "general"
            max_tokens: int = 1024
            temperature: float = 0.3

        class VisionBackend(ABC):
            """Abstract base class for vision analysis backends."""

            @abstractmethod
            async def analyze_frame(
                self,
                frame_base64: str,
                prompt: str,
                system_prompt: Optional[str] = None,
            ) -> str:
                """Analyze a single frame and return the answer text."""
                ...

            @abstractmethod
            async def health_check(self) -> bool:
                """Check if the backend is reachable."""
                ...

            @abstractmethod
            async def close(self):
                """Close any open connections."""
                ...

logger = logging.getLogger(__name__)


@dataclass
class CosmosReasoningResult:
    """Parsed result from Cosmos Reason 2 with chain-of-thought."""
    thinking: str = ""          # Content inside <think>...</think>
    answer: str = ""            # Content inside <answer>...</answer> or after thinking
    raw_response: str = ""      # Full raw response
    latency_ms: float = 0.0
    model: str = ""
    token_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "thinking": self.thinking,
            "answer": self.answer,
            "raw_response": self.raw_response,
            "latency_ms": self.latency_ms,
            "model": self.model,
            "token_count": self.token_count,
        }


def parse_cosmos_response(raw: str) -> Tuple[str, str]:
    """
    Parse Cosmos Reason 2 chain-of-thought response.

    Cosmos outputs: <think>reasoning here</think> answer here
    Or sometimes: <think>reasoning</think><answer>answer</answer>

    Returns (thinking, answer) tuple.
    """
    thinking = ""
    answer = ""

    # Extract <think> block
    think_match = re.search(r"<think>(.*?)</think>", raw, re.DOTALL)
    if think_match:
        thinking = think_match.group(1).strip()

    # Extract <answer> block if present
    answer_match = re.search(r"<answer>(.*?)</answer>", raw, re.DOTALL)
    if answer_match:
        answer = answer_match.group(1).strip()
    else:
        # Answer is everything after </think>
        after_think = re.split(r"</think>", raw, maxsplit=1)
        if len(after_think) > 1:
            answer = after_think[1].strip()
        elif not think_match:
            # No think tags at all — entire response is the answer
            answer = raw.strip()

    return thinking, answer


class CosmosReason2Backend(VisionBackend):
    """
    NVIDIA Cosmos Reason 2 backend for physical reasoning about sports.

    Uses OpenAI-compatible API format. Works with:
    - NVIDIA Build API: https://integrate.api.nvidia.com/v1
    - Nebius: https://<endpoint>/v1
    - Local vLLM: http://localhost:8000/v1

    Environment variables:
    - COSMOS_API_KEY: API key (required for NVIDIA Build / Nebius)
    - COSMOS_ENDPOINT: API endpoint URL
    - COSMOS_MODEL: Model name (default: nvidia/cosmos-reason2-8b)
    """

    # Default endpoints — Jetson NIM container is primary
    JETSON_NIM_ENDPOINT = "http://localhost:8000/v1"
    DEFAULT_MODEL = "nvidia/cosmos-reason2-8b"

    # No fallback — Cosmos Reason 2 is the only backend

    def __init__(
        self,
        config: VisionConfig,
        api_key: Optional[str] = None,
        endpoint: Optional[str] = None,
        model: Optional[str] = None,
    ):
        self.config = config
        self.api_key = api_key or os.environ.get("COSMOS_API_KEY", "")
        self.endpoint = (
            endpoint
            or os.environ.get("COSMOS_ENDPOINT", "")
            or config.endpoint
            or self.JETSON_NIM_ENDPOINT
        )
        self.model = (
            model
            or os.environ.get("COSMOS_MODEL", "")
            or config.model
            or self.DEFAULT_MODEL
        )
        self._client: Optional[httpx.AsyncClient] = None

        # Observability
        self._call_count = 0
        self._total_latency_ms = 0.0
        self._errors = 0

        logger.info(
            "CosmosReason2Backend initialized: endpoint=%s model=%s",
            self.endpoint, self.model,
        )

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            headers = {}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            self._client = httpx.AsyncClient(
                timeout=120.0,
                headers=headers,
            )
        return self._client

    async def analyze_frame(
        self,
        frame_base64: str,
        prompt: str,
        system_prompt: Optional[str] = None,
    ) -> str:
        """
        Analyze a single frame with Cosmos Reason 2.

        Returns the answer portion of the response (without thinking).
        Use analyze_frame_with_reasoning() for full chain-of-thought.
        """
        result = await self.analyze_frame_with_reasoning(
            frame_base64, prompt, system_prompt
        )
        return result.answer

    async def analyze_frame_with_reasoning(
        self,
        frame_base64: str,
        prompt: str,
        system_prompt: Optional[str] = None,
    ) -> CosmosReasoningResult:
        """
        Analyze a frame and return full reasoning chain.

        Returns CosmosReasoningResult with thinking + answer separated.
        """
        client = await self._get_client()
        start = time.monotonic()

        # Build messages
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})

        # Image content — Cosmos uses standard OpenAI vision format
        user_content: List[Dict[str, Any]] = [
            {"type": "text", "text": prompt},
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{frame_base64}"
                },
            },
        ]
        messages.append({"role": "user", "content": user_content})

        result = CosmosReasoningResult(model=self.model)

        try:
            response = await client.post(
                f"{self.endpoint}/chat/completions",
                json={
                    "model": self.model,
                    "messages": messages,
                    "max_tokens": self.config.max_tokens or 1024,
                    "temperature": self.config.temperature,
                },
            )
            response.raise_for_status()
            data = response.json()

            raw = data["choices"][0]["message"]["content"]
            result.raw_response = raw

            # Parse chain-of-thought
            thinking, answer = parse_cosmos_response(raw)
            result.thinking = thinking
            result.answer = answer

            # Token usage
            usage = data.get("usage", {})
            result.token_count = usage.get("total_tokens", 0)

            self._call_count += 1

        except Exception as e:
            self._errors += 1
            logger.error("Cosmos Reason 2 error: %s", e)
            result.answer = ""
            result.thinking = ""

        result.latency_ms = (time.monotonic() - start) * 1000
        self._total_latency_ms += result.latency_ms

        logger.info(
            "Cosmos call #%d: %.0fms, %d tokens, thinking=%d chars, answer=%d chars",
            self._call_count,
            result.latency_ms,
            result.token_count,
            len(result.thinking),
            len(result.answer),
        )

        return result

    async def analyze_video_clip(
        self,
        video_base64: str,
        prompt: str,
        system_prompt: Optional[str] = None,
        fps: float = 4.0,
    ) -> CosmosReasoningResult:
        """
        Analyze a video clip with Cosmos Reason 2.

        Cosmos supports video_url content type for temporal reasoning.
        Send a short clip (2-5 seconds) for contextual analysis of
        ball trajectories, rally sequences, etc.

        Args:
            video_base64: Base64-encoded video (mp4)
            prompt: Analysis prompt
            system_prompt: Optional system context
            fps: Frames per second hint for the model
        """
        client = await self._get_client()
        start = time.monotonic()

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})

        user_content: List[Dict[str, Any]] = [
            {"type": "text", "text": prompt},
            {
                "type": "video_url",
                "video_url": {
                    "url": f"data:video/mp4;base64,{video_base64}"
                },
            },
        ]
        messages.append({"role": "user", "content": user_content})

        result = CosmosReasoningResult(model=self.model)

        try:
            response = await client.post(
                f"{self.endpoint}/chat/completions",
                json={
                    "model": self.model,
                    "messages": messages,
                    "max_tokens": self.config.max_tokens or 1024,
                    "temperature": self.config.temperature,
                    "media_io_kwargs": {"fps": fps},
                },
            )
            response.raise_for_status()
            data = response.json()

            raw = data["choices"][0]["message"]["content"]
            result.raw_response = raw
            thinking, answer = parse_cosmos_response(raw)
            result.thinking = thinking
            result.answer = answer

            usage = data.get("usage", {})
            result.token_count = usage.get("total_tokens", 0)
            self._call_count += 1

        except Exception as e:
            self._errors += 1
            logger.error("Cosmos video analysis error: %s", e)

        result.latency_ms = (time.monotonic() - start) * 1000
        self._total_latency_ms += result.latency_ms
        return result

    async def health_check(self) -> bool:
        """Check if the Cosmos API is reachable."""
        if not self.api_key and "localhost" not in self.endpoint:
            logger.warning("No COSMOS_API_KEY set and not using localhost")
            return False

        try:
            client = await self._get_client()
            response = await client.get(f"{self.endpoint}/models")
            return response.status_code == 200
        except Exception:
            # Try a minimal completion as health check
            try:
                client = await self._get_client()
                response = await client.post(
                    f"{self.endpoint}/chat/completions",
                    json={
                        "model": self.model,
                        "messages": [{"role": "user", "content": "ping"}],
                        "max_tokens": 5,
                    },
                )
                return response.status_code == 200
            except Exception:
                return False

    def get_stats(self) -> Dict[str, Any]:
        """Get observability stats for this backend."""
        avg_latency = (
            self._total_latency_ms / self._call_count
            if self._call_count > 0
            else 0
        )
        return {
            "backend": "cosmos_reason2",
            "model": self.model,
            "endpoint": self.endpoint,
            "calls": self._call_count,
            "errors": self._errors,
            "avg_latency_ms": round(avg_latency, 1),
            "total_latency_ms": round(self._total_latency_ms, 1),
        }

    async def close(self):
        """Close the HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None
