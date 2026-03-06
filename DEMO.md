# Running the Demo

Step-by-step guide to running NVIDIA Cosmos Reason 2 inference on sports video and images.

## Quick Start (with a running endpoint)

If you already have a Cosmos Reason 2 endpoint running (local or remote):

```bash
pip install httpx python-dotenv

# Analyze an included sample image
python demo.py --image demo/samples/tennis.jpg --sport tennis

# Analyze an included video clip
python demo.py --video demo/samples/cricket_clip.mp4 --sport cricket

# Run all analysis modes (scene + physics + commentary)
python demo.py --image demo/samples/badminton.jpg --sport badminton --all-modes

# Save structured output to JSON
python demo.py --image demo/samples/pickleball.jpg --sport pickleball --mode physics --save-output results.json
```

By default `demo.py` connects to `http://localhost:8000/v1`. Override with:

```bash
python demo.py --endpoint http://your-server:8000/v1 --image demo/samples/tennis.jpg --sport tennis
```

## Setting Up the Cosmos Server

Choose one of four deployment options. All serve an OpenAI-compatible API at `http://localhost:8000/v1`.

### Option A: HuggingFace Transformers (Jetson AGX Orin — our setup)

Runs the full 8B model on Jetson AGX Orin 64GB using a custom FastAPI server.

```bash
pip install -r requirements.txt

# Download model (~16GB)
huggingface-cli download nvidia/Cosmos-Reason2-8B --local-dir ./models/cosmos-reason2-8b

# Start the server
python cosmos_server.py --model-path ./models/cosmos-reason2-8b
# Serves at http://localhost:8000/v1/chat/completions
```

Verify the server is running:

```bash
curl http://localhost:8000/health
# {"status": "ok", "model": "nvidia/cosmos-reason2-8b"}
```

### Option B: vLLM

```bash
pip install vllm

vllm serve nvidia/Cosmos-Reason2-8B \
  --allowed-local-media-path "$(pwd)" \
  --max-model-len 16384 \
  --reasoning-parser qwen3 \
  --port 8000
```

### Option C: Edge Deployment (Jetson Orin Nano / L4)

Uses the [W4A16 quantized 2B model](https://huggingface.co/embedl/Cosmos-Reason2-2B-W4A16-Edge2) — INT4 weights with FP16 activations, runs on devices with as little as 8GB VRAM.

```bash
pip install vllm

vllm serve embedl/Cosmos-Reason2-2B-W4A16-Edge2 \
  --allowed-local-media-path "$(pwd)" \
  --max-model-len 8192 \
  --gpu-memory-utilization 0.75 \
  --port 8000
```

### Option D: Local GGUF (Apple Silicon / CPU)

```bash
brew install llama.cpp

# Download quantized model (~8.7GB + 752MB vision encoder)
huggingface-cli download prithivMLmods/Cosmos-Reason2-8B-GGUF \
  Cosmos-Reason2-8B.Q8_0.gguf \
  Cosmos-Reason2-8B.mmproj-q8_0.gguf \
  --local-dir ./models

# Run inference directly (no server needed)
llama-mtmd-cli \
  -m ./models/Cosmos-Reason2-8B.Q8_0.gguf \
  --mmproj ./models/Cosmos-Reason2-8B.mmproj-q8_0.gguf \
  --image demo/samples/cricket.jpg \
  -p "Analyze this cricket frame. Describe the action, player positions, and ball trajectory." \
  --temp 0.3 -n 1024
```

## Analysis Modes

`demo.py` supports three analysis modes driven by sport-specific prompts:

| Mode | Flag | What it does |
|------|------|-------------|
| **Scene** | `--mode scene` | Describes what's happening — player positions, action type, game context |
| **Physics** | `--mode physics` | Reasons about ball trajectory, spin, bounce angles, speed |
| **Commentary** | `--mode commentary` | Generates broadcast-style play-by-play narration |

Run all three at once with `--all-modes`.

## CLI Reference

```
python demo.py [OPTIONS]

Options:
  --image PATH       Path to a sports image (jpg/png)
  --video PATH       Path to a sports video clip (mp4)
  --sport SPORT      Sport type: cricket, tennis, pickleball, badminton, tabletennis, general
  --mode MODE        Analysis mode: scene, physics, commentary (default: scene)
  --all-modes        Run all three analysis modes sequentially
  --endpoint URL     Cosmos API endpoint (default: http://localhost:8000/v1)
  --model NAME       Model name (default: nvidia/cosmos-reason2-8b)
  --save-output PATH Save results to JSON file
  --list-sports      List supported sports and exit
```

## Sample Data Included

The repository includes sample frames and video clips for all five supported sports:

```
demo/samples/
├── cricket.jpg          # ICC T20 World Cup
├── cricket_clip.mp4
├── tennis.jpg           # Roland-Garros (French Open)
├── tennis_clip.mp4
├── badminton.jpg        # BWF Malaysia Masters
├── badminton_clip.mp4
├── pickleball.jpg       # PPA Austin Open
├── pickleball_clip.mp4
├── tabletennis.jpg      # WTT Frankfurt
├── tabletennis_clip.mp4
└── frames/              # 8 sequential frames per sport
    ├── cricket/
    ├── tennis/
    ├── badminton/
    ├── pickleball/
    └── tabletennis/
```

## Expected Output

Running `python demo.py --image demo/samples/tennis.jpg --sport tennis --mode scene` produces:

```
Checking Cosmos Reason 2 endpoint...
Connected to http://localhost:8000/v1 (nvidia/cosmos-reason2-8b)
Loaded image: demo/samples/tennis.jpg (148KB base64)

============================================================
Sport: tennis | Mode: scene
============================================================

Latency: 45400ms | Tokens: 2611

--- THINKING (chain-of-thought) ---
In this frame, the tennis match is taking place on a clay court, with two
players visible. The player in the foreground, wearing a red shirt and white
shorts, is positioned near the baseline, preparing to receive a serve. His
body is slightly bent forward, and his racket is held in a ready position...

--- ANSWER ---
Alcaraz is poised to strike a powerful return, his body coiled like a spring
as he prepares to unleash a thunderous shot that will send the ball hurtling
toward Sinner's court.

The player in red (Alcaraz) is positioned near the baseline, ready to receive
the serve, while the player in yellow (Sinner) is near the service line.

The score displayed on the screen shows that Alcaraz is leading 6-3 in the
first set, with the current game score being 40-15 in favor of Alcaraz.
```

The `<think>` block shows the model's chain-of-thought physical reasoning — analyzing player positions, ball trajectory, court surface, and score context — before producing the final answer.

## Using Your Own Data

Point `demo.py` at any sports image or video:

```bash
# Your own image
python demo.py --image /path/to/your/frame.jpg --sport tennis --all-modes

# Your own video clip (keep clips short — 5-10 seconds works best)
python demo.py --video /path/to/your/clip.mp4 --sport cricket

# Save structured output for downstream processing
python demo.py --image frame.jpg --sport pickleball --mode physics --save-output analysis.json
```

The model works best with:
- Clear, well-lit sports footage
- Standard broadcast or courtside camera angles
- Short video clips (5-10 seconds) for video analysis

## Web-Based Try It Page

The **[Try It](https://refereai-cosmos.vercel.app/try.html)** page lets you connect your own Cosmos endpoint and run inference directly in the browser — no CLI needed. Enter your endpoint URL, pick a sample frame, and see chain-of-thought results.

To use it locally: open `demo/try.html` in your browser and point it at your running Cosmos server.

## Web Demo

The full interactive demo is live at **[refereai-cosmos.vercel.app](https://refereai-cosmos.vercel.app/)**.

To run it locally:

```bash
cd demo
python -m http.server 8080
# Open http://localhost:8080
```

The broadcast view at [/broadcast.html](https://refereai-cosmos.vercel.app/broadcast.html) shows synchronized video playback with Cosmos Reason 2 analysis — chain-of-thought reasoning displayed alongside the action.

## Tests

```bash
python -m pytest tests/ -v
```

Runs tests for the chain-of-thought parser that extracts `<think>...</think>` reasoning from model output.
