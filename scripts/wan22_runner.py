#!/usr/bin/env python3
"""Local Wan 2.2 adapter used by server/video/providers/wan22.js.

Reads a JSON job description from stdin and writes a real MP4 to the requested
output path. It runs strictly from local model files: no API keys, no network
downloads, no paid services, and no placeholder/fake video.

Install the free open-source dependencies yourself, for example:
    pip install torch diffusers transformers accelerate safetensors imageio ffmpeg-python

Then point WAN22_MODEL_DIR at a local Wan 2.2 checkpoint directory, e.g.:
    Wan-AI/Wan2.2-T2V-A14B-Diffusers  (text to video)
    Wan-AI/Wan2.2-I2V-A14B-Diffusers  (image to video)

The exact pipeline arguments can be adjusted for your diffusers version; the
Node.js side only depends on the stdin/stdout contract described below.
"""

import importlib.util
import json
import os
import sys

# Enforce offline operation before importing any ML library.
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("DIFFUSERS_OFFLINE", "1")


def die(message):
    print(message, file=sys.stderr, flush=True)
    sys.exit(2)


def require(module, hint):
    if importlib.util.find_spec(module) is None:
        die("Missing local dependency '%s'. %s" % (module, hint))
    return importlib.import_module(module)


def progress(value):
    print("PROGRESS:%d" % max(0, min(100, int(value))), flush=True)


def main():
    try:
        payload = json.loads(sys.stdin.read())
    except Exception as exc:
        die("Invalid job payload: %s" % exc)

    model_dir = payload.get("modelDir") or ""
    output = payload.get("output") or ""
    prompt = (payload.get("prompt") or "").strip()
    image_path = payload.get("image")
    fps = max(1, min(60, int(payload.get("fps") or 16)))
    duration = max(1, min(30, int(payload.get("duration") or 5)))
    num_frames = duration * fps
    width = int(payload.get("width") or 720)
    height = int(payload.get("height") or 1280)
    mode = payload.get("mode") or ("image" if image_path else "text")

    if not model_dir or not os.path.isdir(model_dir):
        die("WAN22_MODEL_DIR is not set to an existing local folder. Download Wan 2.2 weights locally first.")
    if not output:
        die("No output path was provided.")
    if not prompt:
        die("An empty prompt is not allowed.")
    if mode == "image" and (not image_path or not os.path.isfile(image_path)):
        die("Image-to-video mode requires a real uploaded image file.")

    torch = require("torch", "Install PyTorch for your machine (CPU or CUDA).")
    require("diffusers", "pip install diffusers")
    require("transformers", "pip install transformers")
    require("accelerate", "pip install accelerate")
    export_to_video = require("diffusers.utils").export_to_video

    device = payload.get("device") or "auto"
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32

    progress(5)
    print("Loading local Wan 2.2 weights from %s on %s" % (model_dir, device), flush=True)

    try:
        generator = torch.Generator(device=device).manual_seed(abs(hash(prompt)) % (2 ** 31))
        common = {
            "prompt": prompt,
            "height": height - height % 16,
            "width": width - width % 16,
            "num_frames": num_frames,
            "num_inference_steps": 30,
            "guidance_scale": 5.0,
            "generator": generator,
        }

        if mode == "image":
            from diffusers import WanImageToVideoPipeline
            pipe = WanImageToVideoPipeline.from_pretrained(model_dir, torch_dtype=dtype)
            pipe.to(device)
            from PIL import Image
            image = Image.open(image_path).convert("RGB")
            progress(20)
            result = pipe(image=image, **common).frames
        else:
            from diffusers import WanPipeline
            pipe = WanPipeline.from_pretrained(model_dir, torch_dtype=dtype)
            pipe.to(device)
            progress(20)
            result = pipe(**common).frames

        progress(85)
        frames = result[0] if result and isinstance(result[0], list) else result
        if not frames:
            die("The model returned no frames; refusing to write a fake video.")

        os.makedirs(os.path.dirname(output), exist_ok=True)
        export_to_video(frames, output, fps=fps)
        progress(100)
        print("Wrote real video to %s" % output, flush=True)
    except SystemExit:
        raise
    except Exception as exc:
        die("Wan 2.2 generation failed: %s" % exc)


if __name__ == "__main__":
    main()
