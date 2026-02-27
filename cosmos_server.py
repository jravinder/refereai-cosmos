"""
Cosmos Reason 2 — OpenAI-Compatible Inference Server

Custom FastAPI server wrapping HuggingFace Transformers for NVIDIA Cosmos Reason 2-8B.
Serves OpenAI-compatible /v1/chat/completions on Jetson AGX Orin (CUDA sm_87, 64GB unified memory).

This is "Option A" from the README — the way RefereAI actually runs in production.

Supports:
  - Text messages
  - Image input (base64 data URLs via image_url content)
  - Video input (base64 data URLs via video_url content, extracted to frames with OpenCV)
  - Chain-of-thought reasoning (<think>...</think> tags preserved in output)

Usage:
    python cosmos_server.py
    python cosmos_server.py --model-path ./models/cosmos-reason2-8b
    python cosmos_server.py --port 8001

Endpoints:
    POST /v1/chat/completions   — OpenAI-compatible chat completions
    GET  /v1/models             — List loaded model
    GET  /health                — Health check
"""

import argparse
import base64
import io
import logging
import time
from typing import Any, Dict, List, Optional

import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("cosmos_server")

# ---------------------------------------------------------------------------
# CLI arguments
# ---------------------------------------------------------------------------
parser = argparse.ArgumentParser(description="Cosmos Reason 2 OpenAI-compatible server")
parser.add_argument(
    "--model-path",
    type=str,
    default="nvidia/Cosmos-Reason2-8B",
    help="HuggingFace model ID or local directory (default: nvidia/Cosmos-Reason2-8B)",
)
parser.add_argument("--port", type=int, default=8000, help="Server port (default: 8000)")
parser.add_argument("--host", type=str, default="0.0.0.0", help="Bind address (default: 0.0.0.0)")
args = parser.parse_args()

MODEL_PATH: str = args.model_path
MODEL_NAME: str = "nvidia/cosmos-reason2-8b"  # Canonical name returned in API responses

# ---------------------------------------------------------------------------
# GPU detection
# ---------------------------------------------------------------------------
if torch.cuda.is_available():
    DEVICE = "cuda"
    gpu_name = torch.cuda.get_device_name(0)
    gpu_mem_gb = torch.cuda.get_device_properties(0).total_mem / (1024 ** 3)
    logger.info("GPU detected: %s (%.1f GB)", gpu_name, gpu_mem_gb)
else:
    DEVICE = "cpu"
    logger.warning("No CUDA GPU detected — running on CPU (this will be very slow)")

DTYPE = torch.bfloat16

# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------
logger.info("Loading model from: %s", MODEL_PATH)
logger.info("Device: %s | dtype: %s", DEVICE, DTYPE)

load_start = time.monotonic()

from transformers import AutoProcessor, Qwen3VLForConditionalGeneration  # noqa: E402

model = Qwen3VLForConditionalGeneration.from_pretrained(
    MODEL_PATH,
    torch_dtype=DTYPE,
    device_map="auto",
    trust_remote_code=True,
)
model.eval()

processor = AutoProcessor.from_pretrained(
    MODEL_PATH,
    trust_remote_code=True,
)

load_elapsed = time.monotonic() - load_start
logger.info("Model loaded in %.1f seconds", load_elapsed)

# ---------------------------------------------------------------------------
# Video frame extraction
# ---------------------------------------------------------------------------
MAX_VIDEO_FRAMES = 8


def extract_frames_from_video_bytes(video_bytes: bytes, max_frames: int = MAX_VIDEO_FRAMES) -> List[Any]:
    """
    Extract up to `max_frames` evenly-spaced frames from raw video bytes using OpenCV.

    Returns a list of PIL.Image.Image objects.
    """
    import tempfile
    import cv2
    from PIL import Image

    # OpenCV requires a file path — write to a temporary file
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=True) as tmp:
        tmp.write(video_bytes)
        tmp.flush()

        cap = cv2.VideoCapture(tmp.name)
        if not cap.isOpened():
            raise ValueError("OpenCV could not open the video data")

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total_frames <= 0:
            raise ValueError("Video contains no frames")

        # Pick evenly-spaced frame indices
        n_frames = min(max_frames, total_frames)
        if total_frames <= max_frames:
            indices = list(range(total_frames))
        else:
            step = total_frames / n_frames
            indices = [int(step * i) for i in range(n_frames)]

        frames: List[Image.Image] = []
        for idx in indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ret, frame = cap.read()
            if not ret:
                continue
            # BGR -> RGB
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            frames.append(Image.fromarray(frame_rgb))

        cap.release()

    logger.info("Extracted %d frames from video (%d total)", len(frames), total_frames)
    return frames


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class ContentPart(BaseModel):
    type: str
    text: Optional[str] = None
    image_url: Optional[Dict[str, str]] = None
    video_url: Optional[Dict[str, str]] = None


class Message(BaseModel):
    role: str
    content: Any  # str or list of ContentPart dicts


class ChatCompletionRequest(BaseModel):
    model: str = MODEL_NAME
    messages: List[Message]
    max_tokens: int = Field(default=1024, ge=1, le=16384)
    temperature: float = Field(default=0.6, ge=0.0, le=2.0)
    top_p: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    stream: bool = False


class UsageInfo(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class ChoiceMessage(BaseModel):
    role: str = "assistant"
    content: str


class Choice(BaseModel):
    index: int = 0
    message: ChoiceMessage
    finish_reason: str = "stop"


class ChatCompletionResponse(BaseModel):
    id: str
    object: str = "chat.completion"
    created: int
    model: str
    choices: List[Choice]
    usage: UsageInfo


class ModelInfo(BaseModel):
    id: str
    object: str = "model"
    created: int
    owned_by: str


class ModelListResponse(BaseModel):
    object: str = "list"
    data: List[ModelInfo]


class HealthResponse(BaseModel):
    status: str
    model: str
    device: str
    gpu: Optional[str]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_request_id() -> str:
    """Generate a request ID in the format chatcmpl-refereai-{timestamp}."""
    ts = int(time.time() * 1000)
    return f"chatcmpl-refereai-{ts}"


def decode_data_url(data_url: str) -> bytes:
    """
    Decode a base64 data URL (e.g. data:image/jpeg;base64,/9j/...) to raw bytes.
    Also accepts raw base64 strings without the data URL prefix.
    """
    if data_url.startswith("data:"):
        # Strip the prefix: data:<mime>;base64,<data>
        _, encoded = data_url.split(",", 1)
    else:
        encoded = data_url
    return base64.b64decode(encoded)


def build_processor_messages(messages: List[Message]) -> tuple:
    """
    Convert OpenAI-format messages into the format expected by the
    Qwen3VL processor: a list of message dicts with content parts,
    plus a list of PIL images/frames for vision inputs.

    Returns (processor_messages, images_list).
    """
    from PIL import Image as PILImage

    processor_messages: List[Dict[str, Any]] = []
    images: List[Any] = []

    for msg in messages:
        role = msg.role

        # Simple text message
        if isinstance(msg.content, str):
            processor_messages.append({"role": role, "content": msg.content})
            continue

        # Multimodal content parts
        parts: List[Dict[str, Any]] = []
        for part in msg.content:
            # Normalize: could be a dict or a ContentPart
            if isinstance(part, dict):
                p_type = part.get("type", "text")
                p_text = part.get("text")
                p_image_url = part.get("image_url")
                p_video_url = part.get("video_url")
            else:
                p_type = part.type
                p_text = part.text
                p_image_url = part.image_url
                p_video_url = part.video_url

            if p_type == "text" and p_text:
                parts.append({"type": "text", "text": p_text})

            elif p_type == "image_url" and p_image_url:
                url = p_image_url.get("url", "") if isinstance(p_image_url, dict) else p_image_url
                image_bytes = decode_data_url(url)
                pil_image = PILImage.open(io.BytesIO(image_bytes)).convert("RGB")
                images.append(pil_image)
                parts.append({"type": "image", "image": pil_image})

            elif p_type == "video_url" and p_video_url:
                url = p_video_url.get("url", "") if isinstance(p_video_url, dict) else p_video_url
                video_bytes = decode_data_url(url)
                frames = extract_frames_from_video_bytes(video_bytes)
                images.extend(frames)
                # Add each frame as a separate image part so the model sees the sequence
                for frame in frames:
                    parts.append({"type": "image", "image": frame})

        processor_messages.append({"role": role, "content": parts})

    return processor_messages, images


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Cosmos Reason 2 Server",
    description="OpenAI-compatible inference server for NVIDIA Cosmos Reason 2-8B",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Track server start time
_server_start = int(time.time())


@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint."""
    gpu_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else None
    return HealthResponse(
        status="ok",
        model=MODEL_PATH,
        device=DEVICE,
        gpu=gpu_name,
    )


@app.get("/v1/models", response_model=ModelListResponse)
async def list_models():
    """List available models (OpenAI-compatible)."""
    return ModelListResponse(
        data=[
            ModelInfo(
                id=MODEL_NAME,
                created=_server_start,
                owned_by="nvidia",
            )
        ]
    )


@app.post("/v1/chat/completions", response_model=ChatCompletionResponse)
async def chat_completions(request: ChatCompletionRequest):
    """
    OpenAI-compatible chat completions endpoint.

    Accepts text, image_url (base64), and video_url (base64) content.
    """
    if request.stream:
        raise HTTPException(
            status_code=400,
            detail="Streaming is not supported. Set stream=false.",
        )

    request_id = make_request_id()
    start = time.monotonic()

    logger.info(
        "[%s] Chat completion request: %d messages, max_tokens=%d, temperature=%.2f",
        request_id,
        len(request.messages),
        request.max_tokens,
        request.temperature,
    )

    try:
        # Build processor-compatible messages and extract images
        proc_messages, images = build_processor_messages(request.messages)

        # Apply the chat template to get the text prompt
        text_prompt = processor.apply_chat_template(
            proc_messages,
            tokenize=False,
            add_generation_prompt=True,
        )

        # Tokenize with the processor (handles both text and vision inputs)
        if images:
            inputs = processor(
                text=[text_prompt],
                images=images if images else None,
                return_tensors="pt",
                padding=True,
            )
        else:
            inputs = processor(
                text=[text_prompt],
                return_tensors="pt",
                padding=True,
            )

        inputs = inputs.to(model.device)
        prompt_token_count = inputs["input_ids"].shape[-1]

        # Generation parameters
        gen_kwargs: Dict[str, Any] = {
            "max_new_tokens": request.max_tokens,
            "temperature": request.temperature if request.temperature > 0 else 1.0,
            "do_sample": request.temperature > 0,
        }
        if request.top_p is not None and request.temperature > 0:
            gen_kwargs["top_p"] = request.top_p

        # Run inference
        with torch.inference_mode():
            output_ids = model.generate(**inputs, **gen_kwargs)

        # Decode only the generated tokens (strip the prompt)
        generated_ids = output_ids[0, prompt_token_count:]
        completion_text = processor.decode(generated_ids, skip_special_tokens=True)
        completion_token_count = len(generated_ids)

        elapsed_ms = (time.monotonic() - start) * 1000

        logger.info(
            "[%s] Completed in %.0fms — prompt_tokens=%d, completion_tokens=%d",
            request_id,
            elapsed_ms,
            prompt_token_count,
            completion_token_count,
        )

        return ChatCompletionResponse(
            id=request_id,
            created=int(time.time()),
            model=MODEL_NAME,
            choices=[
                Choice(
                    message=ChoiceMessage(content=completion_text),
                    finish_reason="stop",
                )
            ],
            usage=UsageInfo(
                prompt_tokens=prompt_token_count,
                completion_tokens=completion_token_count,
                total_tokens=prompt_token_count + completion_token_count,
            ),
        )

    except Exception as e:
        elapsed_ms = (time.monotonic() - start) * 1000
        logger.error("[%s] Error after %.0fms: %s", request_id, elapsed_ms, e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logger.info("Starting Cosmos Reason 2 server on %s:%d", args.host, args.port)
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="info",
        access_log=True,
    )
