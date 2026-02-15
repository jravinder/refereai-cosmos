# RefereAI x Cosmos Reason 2

**AI-powered sports companion with physical reasoning** — ball tracking, AI commentary, live scoring, and Hawk-Eye style replay analysis for amateur sports.

Built for the [NVIDIA Cosmos Cookoff](https://luma.com/nvidia-cosmos-cookoff) hackathon.

## What It Does

RefereAI uses **NVIDIA Cosmos Reason 2** to bring professional-level AI analysis to any sports match with just a camera and a phone:

- **Ball Tracking** — Physical reasoning about trajectories, spin, bounce angles
- **AI Commentary** — Scene understanding drives context-aware commentary in 6 languages
- **Scoring Decisions** — Line calls (in/out), boundary detection, rule compliance with chain-of-thought reasoning
- **Replay Analysis** — Post-play reasoning about what happened and why
- **Multi-Sport** — Cricket, tennis, pickleball, badminton, table tennis from one system

### Why Cosmos Reason 2?

Cosmos Reason 2 doesn't just classify — it **reasons about physics**. When analyzing a tennis serve, it thinks through ball trajectory, spin, landing prediction relative to court lines, and bounce angle before making an in/out call. This chain-of-thought reasoning (`<think>...</think>`) provides transparent, explainable decisions.

## Architecture

```
Camera → Jetson AGX Orin 64GB (everything on-device)
   ├── Frame capture + event detection
   ├── Cosmos Reason 2-8B (NIM container on local GPU)
   │   ├── Scene understanding → what's happening?
   │   ├── Physical reasoning → ball physics, trajectories
   │   └── Commentary generation → context-aware play-by-play
   ├── ScoringEngine → scoring decisions
   └── WebSocket → Mobile App (live scores + commentary)
```

**Cloud fallback**: Same pipeline works with Nebius-hosted Cosmos for scalability.

## Quick Start

### Prerequisites

- NVIDIA Jetson AGX Orin (64GB) with JetPack 6.x
- Docker installed
- NGC API key from [build.nvidia.com](https://build.nvidia.com/nvidia/cosmos-reason2-8b)

### 1. Deploy Cosmos NIM on Jetson

```bash
# Login to NGC
docker login nvcr.io
# Username: $oauthtoken
# Password: <your NGC API key>

# Pull and run the NIM container
export NGC_API_KEY=<your-key>
export LOCAL_NIM_CACHE=~/.cache/nim
mkdir -p "$LOCAL_NIM_CACHE"

docker run -d --name cosmos-nim \
  --gpus all --ipc host --shm-size=32GB \
  -e NGC_API_KEY \
  -v "$LOCAL_NIM_CACHE:/opt/nim/.cache" \
  -p 8000:8000 \
  nvcr.io/nim/nvidia/cosmos-reason2-8b:latest
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env with your API key and endpoint
```

### 3. Run Demo

```bash
pip install httpx python-dotenv

# Analyze a cricket frame
python demo.py --image cricket_frame.jpg --sport cricket --all-modes

# Analyze a tennis video clip
python demo.py --video tennis_rally.mp4 --sport tennis

# List supported sports
python demo.py --list-sports
```

## Files

| File | Purpose |
|------|---------|
| `cosmos_reason2.py` | `CosmosReason2Backend` — VisionBackend implementation with chain-of-thought parsing, video clip support, observability |
| `cosmos_prompts.py` | Sport-specific physical reasoning prompts (5 sports x 5 modes) |
| `cosmos_sports_agent.py` | `CosmosScorePipeline` — agentic loop: frame → Cosmos → GameEvent → ScoringEngine → WebSocket |
| `demo.py` | CLI demo script for testing |
| `.env.example` | Configuration template |

## How the Reasoning Works

Cosmos Reason 2 outputs structured chain-of-thought:

```
<think>
The ball appears to be traveling at high speed toward the boundary rope.
Based on the trajectory angle and current position, it will cross the
rope on the full — no fielder is in position to cut it off. The batsman
appears to have played a cover drive.
</think>

{"event": "boundary_4", "confidence": 0.92, "description": "Cover drive races to the boundary"}
```

This reasoning chain is:
1. **Transparent** — you can see WHY the AI made a call
2. **Observable** — logged with latency and confidence for every decision
3. **Displayed** — shown to spectators in the mobile app's "AI Reasoning" panel

## Supported Sports

| Sport | Events Detected | Physical Reasoning |
|-------|----------------|-------------------|
| Cricket | Boundary 4/6, wicket, wide, no-ball, dot, run | Ball trajectory, stump alignment, boundary crossing, shot classification |
| Tennis | In/out, ace, double fault, winner | Line calls, spin analysis, serve placement, court positioning |
| Pickleball | Point, fault, kitchen violation | Kitchen line proximity, dink vs drive physics, serve legality |
| Badminton | Point, fault, let | Smash speed, shuttlecock deceleration, boundary detection |
| Table Tennis | Point, let, fault | Ball spin from paddle angle, net clips, edge detection |

## Hardware

**Jetson AGX Orin 64GB** — 64GB shared GPU/CPU memory runs Cosmos Reason 2-8B on-device alongside the full edge pipeline. True edge AI: no internet required for inference.

## Team

Built by [Ravinder Jilkapally](https://github.com/jravinder) and the RefereAI team.

---

Built for the [NVIDIA Cosmos Cookoff](https://luma.com/nvidia-cosmos-cookoff) | Powered by [NVIDIA Cosmos Reason 2](https://build.nvidia.com/nvidia/cosmos-reason2-8b)
