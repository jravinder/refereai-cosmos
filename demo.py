"""
RefereAI x Cosmos Reason 2 — Demo Script

Tests Cosmos Reason 2 physical reasoning on sports video/images.
Run on Jetson AGX Orin with NIM container, or point to any
OpenAI-compatible Cosmos endpoint.

Usage:
    # Analyze a sports image
    python demo.py --image cricket_frame.jpg --sport cricket

    # Analyze a video clip
    python demo.py --video tennis_rally.mp4 --sport tennis

    # List supported sports
    python demo.py --list-sports

Prerequisites:
    - Cosmos Reason 2 NIM container running (localhost:8000)
    - pip install httpx python-dotenv
"""
import argparse
import asyncio
import base64
import json
import os
import sys
import time

# Add parent dir for imports
sys.path.insert(0, os.path.dirname(__file__))

from cosmos_reason2 import CosmosReason2Backend, CosmosReasoningResult
from cosmos_prompts import (
    get_system_prompt,
    get_scene_prompt,
    get_physical_reasoning_prompt,
    get_commentary_prompt,
    SUPPORTED_SPORTS,
)

# Minimal VisionConfig substitute (avoids importing full vision_commentary)
class SimpleConfig:
    def __init__(self, endpoint=None, model=None, max_tokens=1024, temperature=0.3):
        self.provider = "cosmos_reason2"
        self.endpoint = endpoint or os.environ.get("COSMOS_ENDPOINT", "http://localhost:8000/v1")
        self.model = model or os.environ.get("COSMOS_MODEL", "nvidia/cosmos-reason2-8b")
        self.max_tokens = max_tokens
        self.temperature = temperature
        self.sport = "general"


def load_image_base64(path: str) -> str:
    """Load an image file and return base64 string."""
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def load_video_base64(path: str) -> str:
    """Load a video file and return base64 string."""
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


async def analyze_image(backend, image_b64: str, sport: str, mode: str):
    """Run analysis on a single image."""
    system_prompt = get_system_prompt(sport)

    if mode == "scene":
        prompt = get_scene_prompt(sport)
    elif mode == "physics":
        prompt = get_physical_reasoning_prompt(sport)
    elif mode == "commentary":
        prompt = get_commentary_prompt(sport, "Demo mode — no live score")
    else:
        prompt = get_scene_prompt(sport)

    print(f"\n{'='*60}")
    print(f"Sport: {sport} | Mode: {mode}")
    print(f"{'='*60}")

    result = await backend.analyze_frame_with_reasoning(image_b64, prompt, system_prompt)

    print(f"\nLatency: {result.latency_ms:.0f}ms | Tokens: {result.token_count}")

    if result.thinking:
        print(f"\n--- THINKING (chain-of-thought) ---")
        print(result.thinking[:500])
        if len(result.thinking) > 500:
            print(f"... ({len(result.thinking)} chars total)")

    print(f"\n--- ANSWER ---")
    print(result.answer)

    return result


async def analyze_video(backend, video_b64: str, sport: str):
    """Run analysis on a video clip."""
    from cosmos_prompts import get_video_clip_prompt

    system_prompt = get_system_prompt(sport)
    prompt = get_video_clip_prompt(sport)

    print(f"\n{'='*60}")
    print(f"Video Analysis | Sport: {sport}")
    print(f"{'='*60}")

    result = await backend.analyze_video_clip(video_b64, prompt, system_prompt)

    print(f"\nLatency: {result.latency_ms:.0f}ms | Tokens: {result.token_count}")

    if result.thinking:
        print(f"\n--- THINKING ---")
        print(result.thinking[:500])

    print(f"\n--- ANSWER ---")
    print(result.answer)

    return result


async def main():
    parser = argparse.ArgumentParser(description="RefereAI Cosmos Reason 2 Demo")
    parser.add_argument("--image", help="Path to sports image (jpg/png)")
    parser.add_argument("--video", help="Path to sports video (mp4)")
    parser.add_argument("--sport", default="cricket", choices=SUPPORTED_SPORTS + ["general"])
    parser.add_argument("--mode", default="scene", choices=["scene", "physics", "commentary"])
    parser.add_argument("--endpoint", help="Cosmos API endpoint")
    parser.add_argument("--model", help="Model name")
    parser.add_argument("--list-sports", action="store_true", help="List supported sports")
    parser.add_argument("--all-modes", action="store_true", help="Run all analysis modes")
    parser.add_argument("--save-output", help="Save results to JSON file")
    args = parser.parse_args()

    if args.list_sports:
        print("Supported sports:")
        for s in SUPPORTED_SPORTS:
            print(f"  - {s}")
        return

    if not args.image and not args.video:
        parser.print_help()
        print("\nProvide --image or --video to analyze.")
        return

    # Try loading .env
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass

    # Initialize backend
    config = SimpleConfig(endpoint=args.endpoint, model=args.model)
    backend = CosmosReason2Backend(config)

    # Health check
    print("Checking Cosmos Reason 2 endpoint...")
    healthy = await backend.health_check()
    if not healthy:
        print(f"WARNING: Cosmos endpoint not reachable at {config.endpoint}")
        print("Make sure the NIM container is running:")
        print("  docker run --gpus all -p 8000:8000 nvcr.io/nim/nvidia/cosmos-reason2-8b:latest")
        return

    print(f"Connected to {config.endpoint} ({config.model})")

    result = None

    if args.image:
        image_b64 = load_image_base64(args.image)
        print(f"Loaded image: {args.image} ({len(image_b64) // 1024}KB base64)")

        if args.all_modes:
            for mode in ["scene", "physics", "commentary"]:
                result = await analyze_image(backend, image_b64, args.sport, mode)
        else:
            result = await analyze_image(backend, image_b64, args.sport, args.mode)

    elif args.video:
        video_b64 = load_video_base64(args.video)
        print(f"Loaded video: {args.video} ({len(video_b64) // 1024}KB base64)")
        result = await analyze_video(backend, video_b64, args.sport)

    # Print stats
    stats = backend.get_stats()
    print(f"\n--- Backend Stats ---")
    print(json.dumps(stats, indent=2))

    # Save output if requested
    if args.save_output and result:
        output = {
            "sport": args.sport,
            "mode": args.mode if not args.all_modes else "all",
            "thinking": result.thinking,
            "answer": result.answer,
            "raw_response": result.raw_response,
            "latency_ms": result.latency_ms,
            "token_count": result.token_count,
            "model": result.model,
            "stats": stats,
        }
        with open(args.save_output, "w") as f:
            json.dump(output, f, indent=2)
        print(f"\nOutput saved to {args.save_output}")

    await backend.close()


if __name__ == "__main__":
    asyncio.run(main())
