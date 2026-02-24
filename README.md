# RefereAI x Cosmos Reason 2

**AI-powered sports companion with physical reasoning** — ball tracking, AI commentary, live scoring, and chain-of-thought decision-making for amateur sports.

Built for the [NVIDIA Cosmos Cookoff](https://luma.com/nvidia-cosmos-cookoff) hackathon.

## What It Does

RefereAI uses **NVIDIA Cosmos Reason 2** to bring professional-level AI analysis to any sports match with just a camera and a phone:

- **Ball Tracking** — Physical reasoning about trajectories, spin, bounce angles
- **AI Commentary** — Scene understanding drives context-aware play-by-play commentary
- **Scoring Decisions** — Line calls (in/out), boundary detection, rule compliance with chain-of-thought reasoning
- **Video Analysis** — Post-play reasoning about what happened and why
- **Multi-Sport** — Cricket, tennis, pickleball, badminton, table tennis from one system

### Why Cosmos Reason 2?

Cosmos Reason 2 doesn't just classify — it **reasons about physics**. When analyzing a tennis serve, it thinks through ball trajectory, spin, landing prediction relative to court lines, and bounce angle before making an in/out call. This chain-of-thought reasoning (`<think>...</think>`) provides transparent, explainable decisions.

## Architecture

```
Camera → Jetson AGX Orin 64GB (everything on-device)
   ├── Frame capture + event detection
   ├── Cosmos Reason 2-8B (HuggingFace Transformers on local GPU)
   │   ├── Scene understanding → what's happening?
   │   ├── Physical reasoning → ball physics, trajectories
   │   └── Commentary generation → context-aware play-by-play
   ├── LiteLLM proxy (per-app API keys, usage tracking)
   ├── ScoringEngine → scoring decisions
   └── WebSocket → Mobile App (live scores + commentary)
```

**Public access**: Tailscale Funnel exposes LiteLLM proxy, Vercel serverless function proxies requests from the demo site.

## Quick Start

### Prerequisites

- GPU with 32GB+ VRAM (Jetson AGX Orin 64GB, or similar)
- Python 3.10+ with `pip install torch transformers httpx python-dotenv`

### Option A: HuggingFace Transformers (Our Setup)

```bash
# Download model from HuggingFace
huggingface-cli download nvidia/Cosmos-Reason2-8B --local-dir ./models/cosmos-reason2-8b

# Run the OpenAI-compatible server
python cosmos_server.py
# Serves at http://localhost:8000/v1/chat/completions
```

This is how RefereAI runs on Jetson AGX Orin — a custom FastAPI server wrapping
`Qwen3VLForConditionalGeneration` with OpenAI-compatible endpoints, image and video support.

### Option B: vLLM

```bash
pip install vllm
vllm serve nvidia/Cosmos-Reason2-8B \
  --allowed-local-media-path "$(pwd)" \
  --max-model-len 16384 \
  --reasoning-parser qwen3 \
  --port 8000
```

### Option C: Local GGUF (Apple Silicon / CPU)

```bash
# Install llama.cpp
brew install llama.cpp

# Download quantized model (8.71GB + 752MB vision encoder)
huggingface-cli download prithivMLmods/Cosmos-Reason2-8B-GGUF \
  Cosmos-Reason2-8B.Q8_0.gguf \
  Cosmos-Reason2-8B.mmproj-q8_0.gguf \
  --local-dir ./models

# Run inference on an image
llama-mtmd-cli \
  -m ./models/Cosmos-Reason2-8B.Q8_0.gguf \
  --mmproj ./models/Cosmos-Reason2-8B.mmproj-q8_0.gguf \
  --image cricket_test.jpg \
  -p "Analyze this cricket frame..." \
  --temp 0.3 -n 1024
```

### Configure and Run

```bash
cp .env.example .env
# Edit .env — default endpoint is http://localhost:8000/v1

pip install httpx python-dotenv

# Analyze a cricket frame
python demo.py --image cricket_frame.jpg --sport cricket --all-modes

# Analyze a tennis video clip
python demo.py --video tennis_rally.mp4 --sport tennis

# Save output to JSON
python demo.py --image frame.jpg --sport cricket --mode physics --save-output output.json

# List supported sports
python demo.py --list-sports
```

## Files

| File | Purpose |
|------|---------|
| `cosmos_reason2.py` | `CosmosReason2Backend` — VisionBackend implementation with chain-of-thought parsing, video clip support, observability |
| `cosmos_prompts.py` | Sport-specific physical reasoning prompts (5 sports x 3 modes) |
| `cosmos_sports_agent.py` | `CosmosScorePipeline` — agentic loop: frame → Cosmos → GameEvent → ScoringEngine → WebSocket |
| `demo.py` | CLI demo script for testing |
| `index.html` | Submission showcase page (open in browser) |
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

**Jetson AGX Orin 64GB** — 64GB shared GPU/CPU memory runs Cosmos Reason 2-8B on-device via HuggingFace Transformers, fronted by LiteLLM proxy for per-app API keys and usage tracking. Tailscale Funnel exposes the endpoint publicly. True edge AI: no cloud compute required.

## Team

Built by [Ravinder Jilkapally](https://github.com/jravinder).

---

Built for the [NVIDIA Cosmos Cookoff](https://luma.com/nvidia-cosmos-cookoff) | Powered by [NVIDIA Cosmos Reason 2](https://build.nvidia.com/nvidia/cosmos-reason2-8b)
