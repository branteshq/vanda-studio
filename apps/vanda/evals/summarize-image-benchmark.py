"""Run with: uv run --with pillow apps/vanda/evals/summarize-image-benchmark.py ROOT.

ROOT contains arm/timestamp/case/{result,failure}.json. Never discard repeats.
Writes review sheets and metrics, not automated aesthetic judgments.
"""
import csv
import json
import sys
from collections import defaultdict, deque
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

root = Path(sys.argv[1]).resolve()
rows = []
groups = defaultdict(list)
for directory in sorted({p.parent for name in ("result.json", "failure.json") for p in root.glob(f"*/*/*/{name}")}):
    result_path = directory / "result.json"
    failure_path = directory / "failure.json"
    result = json.loads((result_path if result_path.exists() else failure_path).read_text())
    state = result.get("state", {})
    requests = result.get("imageRequests", [])
    usage_complete = all(r.get("usage") is not None for r in requests)
    image_value = 0
    for request in requests:
        usage = request.get("usage") or {}
        details = usage.get("input_tokens_details", {})
        # No cache detail is returned by the observed image endpoint: uncached valuation.
        image_value += (details.get("text_tokens", 0) * 5 + details.get("image_tokens", 0) * 8
                        + usage.get("output_tokens", 0) * 30) / 1_000_000
    input_tokens = cached_tokens = output_tokens = text_value = 0
    for step in result.get("trace", []):
        usage = step.get("usage") or {}
        inp = usage.get("inputTokens", 0)
        cached = usage.get("cachedInputTokens", 0)
        out = usage.get("outputTokens", 0)
        input_tokens += inp
        cached_tokens += cached
        output_tokens += out
        # GPT-5.6 Terra standard rate card; context >272K has a premium.
        text_value += ((inp - cached) * 2 + cached * .2) * (2 if inp > 272_000 else 1) / 1_000_000
        text_value += out * 12 * (1.5 if inp > 272_000 else 1) / 1_000_000
    runs = state.get("runs", [])
    sandbox_estimate = sum(r.get("costUsd", 0) for r in runs)
    ids = [i for post in state.get("posts", []) for i in post["imageIds"]]
    if result["entry"]["kind"] == "revision":
        ids = [image["_id"] for image in state.get("images", []) if image.get("storageId")][-1:]
    images = [directory / f"{i}.png" for i in ids]
    protected_changed = None
    if result["entry"]["kind"] == "revision" and images:
        before = Image.open(directory / "reference.png").convert("RGBA")
        after = Image.open(images[-1]).convert("RGBA")
        if before.size == after.size:
            # Same protected region contract as assertions.ts: non-background pixels
            # plus the enclosed purple pen, which deliberately shares the background RGB.
            background = before.getpixel((0, 0))
            pen = {(497, 500)}
            queue = deque(pen)
            while queue:
                x, y = queue.popleft()
                for point in ((x-1, y), (x+1, y), (x, y-1), (x, y+1)):
                    px, py = point
                    if (0 <= px < before.width and 0 <= py < before.height
                            and point not in pen and before.getpixel(point) == background):
                        pen.add(point)
                        queue.append(point)
            protected_changed = sum(
                original != revised and (original != background or (i % before.width, i // before.width) in pen)
                for i, (original, revised) in enumerate(zip(before.getdata(), after.getdata()))
            )
    row = dict(
        arm=directory.parents[1].name, batch=directory.parent.name, case=result["entry"]["id"],
        kind=result["entry"]["kind"], structural_pass=not failure_path.exists(),
        elapsed_s=round(result["elapsedMs"] / 1000, 2), final_slides=len(images),
        image_calls=len(requests), reference_calls=sum(r["references"] > 0 for r in requests),
        image_request_s=round(sum(r["elapsedMs"] for r in requests) / 1000, 2),
        image_api_equivalent_usd=round(image_value, 6) if usage_complete else None,
        orchestrator_api_equivalent_usd=round(text_value, 6),
        sandbox_estimated_usd=round(sandbox_estimate, 6),
        tracked_total_equivalent_usd=round(image_value + text_value + sandbox_estimate, 6) if usage_complete else None,
        input_tokens=input_tokens, cached_tokens=cached_tokens, output_tokens=output_tokens,
        code_runs=len(runs), failed_code_runs=sum(r.get("status") == "failed" for r in runs),
        actual_sizes=";".join(f"{Image.open(p).width}x{Image.open(p).height}" for p in images),
        protected_changed_pixels=protected_changed,
        failure=json.loads(failure_path.read_text())["error"] if failure_path.exists() else "",
        artifact=str(directory.relative_to(root)),
    )
    rows.append(row)
    groups[row["case"]].append((row, images))

if not rows:
    raise SystemExit("No benchmark records found")
with (root / "metrics.csv").open("w") as file:
    writer = csv.DictWriter(file, fieldnames=rows[0])
    writer.writeheader()
    writer.writerows(rows)
(root / "metrics.json").write_text(json.dumps(rows, indent=2))

font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 19)
for case, entries in groups.items():
    columns = max(1, max(len(images) for _, images in entries))
    sheet = Image.new("RGB", (columns * 360, len(entries) * 510), "#e8e8e8")
    draw = ImageDraw.Draw(sheet)
    for row_index, (row, images) in enumerate(entries):
        y = row_index * 510
        draw.text((8, y + 5), f'{row["arm"]} | {row["elapsed_s"]}s', fill="black", font=font)
        draw.text((8, y + 29), row["batch"], fill="black", font=font)
        for column, image_path in enumerate(images):
            source = Image.open(image_path).convert("RGBA")
            image = Image.alpha_composite(Image.new("RGBA", source.size, "white"), source).convert("RGB")
            image.thumbnail((352, 440))
            sheet.paste(image, (column * 360 + 4, y + 65))
    sheet.save(root / f"{case}-comparison.jpg", quality=95)
print(json.dumps(rows, indent=2))
