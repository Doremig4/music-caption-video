import json
import re
import sys
from pathlib import Path


def chars(text):
    return [c.lower() for c in text if c.isalnum()]


def read_lyrics(path):
    data = Path(path).read_bytes()
    for encoding in ("utf-8-sig", "cp949"):
        try:
            text = data.decode(encoding)
            break
        except UnicodeDecodeError:
            pass
    else:
        raise ValueError("TXT 인코딩은 UTF-8 또는 CP949여야 합니다.")

    heading = re.compile(r"^(?:\d{1,2}\.\s|prod(?:uced)?\s+by\b|[\[(]?\s*(?:verse|hook|chorus|bridge|intro|outro)\b)", re.I)
    lines = [line.strip() for line in text.splitlines() if line.strip() and not heading.match(line.strip()) and chars(line)]
    if not lines:
        raise ValueError("TXT에서 가사 문장을 찾지 못했습니다.")
    return lines, text


def align(lines, segments):
    source = [(c, line_no) for line_no, line in enumerate(lines) for c in chars(line)]
    heard = []
    for segment in segments:
        for word in segment["words"]:
            word_chars = chars(word["text"])
            if not word_chars:
                continue
            span = (word["end"] - word["start"]) / len(word_chars)
            heard.extend((c, word["start"] + i * span, word["start"] + (i + 1) * span) for i, c in enumerate(word_chars))
    if not heard:
        raise ValueError("음성에서 단어 타임스탬프를 찾지 못했습니다.")

    n, m = len(source), len(heard)
    dp = [list(range(m + 1))]
    for i in range(1, n + 1):
        row = [i] + [0] * m
        for j in range(1, m + 1):
            row[j] = min(dp[i - 1][j] + 1, row[j - 1] + 1, dp[i - 1][j - 1] + (source[i - 1][0] != heard[j - 1][0]))
        dp.append(row)

    matches = [[] for _ in lines]
    i, j = n, m
    while i or j:
        if i and j and dp[i][j] == dp[i - 1][j - 1] + (source[i - 1][0] != heard[j - 1][0]):
            if source[i - 1][0] == heard[j - 1][0]:
                matches[source[i - 1][1]].append(heard[j - 1][1:])
            i -= 1
            j -= 1
        elif i and dp[i][j] == dp[i - 1][j] + 1:
            i -= 1
        else:
            j -= 1

    raw = []
    for matched in matches:
        matched.sort()
        raw.append([matched[0][0], matched[-1][1]] if matched else None)
    for k, item in enumerate(raw):
        if item:
            continue
        left = next((p for p in range(k - 1, -1, -1) if raw[p]), None)
        right = next((p for p in range(k + 1, len(raw)) if raw[p]), None)
        lo = raw[left][1] if left is not None else segments[0]["start"]
        hi = raw[right][0] if right is not None else segments[-1]["end"]
        group = range((left + 1) if left is not None else 0, right if right is not None else len(raw))
        total = sum(len(chars(lines[p])) for p in group)
        before = sum(len(chars(lines[p])) for p in group if p < k)
        size = len(chars(lines[k]))
        raw[k] = [lo + (hi - lo) * before / total, lo + (hi - lo) * (before + size) / total]

    cues = []
    for k, ((start, end), line) in enumerate(zip(raw, lines)):
        start = max(0, start - 0.08, cues[-1][1] + 0.04 if cues else 0)
        next_start = raw[k + 1][0] - 0.08 if k + 1 < len(raw) else end + 0.15
        end = max(start + 0.35, min(end + 0.15, next_start - 0.04))
        cues.append((start, end, line))
    return cues


def stamp(seconds):
    milliseconds = max(0, round(seconds * 1000))
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    seconds, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02}:{minutes:02}:{seconds:02},{milliseconds:03}"


def write_srt(path, cues):
    with open(path, "w", encoding="utf-8", newline="\n") as output:
        for index, (start, end, line) in enumerate(cues, 1):
            output.write(f"{index}\n{stamp(start)} --> {stamp(end)}\n{line}\n\n")


def self_test():
    segments = [{"start": 1.0, "end": 3.0, "words": [{"start": 1.0, "end": 2.0, "text": "안녕"}, {"start": 2.0, "end": 3.0, "text": "하세요"}]}]
    cues = align(["안녕", "하세요"], segments)
    assert len(cues) == 2 and cues[0][0] < cues[0][1] < cues[1][0] < cues[1][1]
    print("ok")


def main():
    if sys.argv[1:] == ["--self-test"]:
        self_test()
        return
    if len(sys.argv) != 4:
        raise ValueError("usage: generate_srt.py music.mp3 lyrics.txt lyrics.srt")

    from faster_whisper import WhisperModel

    audio_path, lyrics_path, output_path = sys.argv[1:]
    lines, prompt = read_lyrics(lyrics_path)
    print("STATUS Whisper 모델 준비 중", flush=True)
    model = WhisperModel("small", device="cpu", compute_type="int8")
    print("STATUS 음성과 가사 분석 중", flush=True)
    generated, info = model.transcribe(
        audio_path,
        language="ko",
        beam_size=5,
        word_timestamps=True,
        initial_prompt=prompt.replace("\r", " ").replace("\n", " "),
        condition_on_previous_text=True,
    )
    segments = []
    for segment in generated:
        segments.append({
            "start": segment.start,
            "end": segment.end,
            "words": [{"start": word.start, "end": word.end, "text": word.word} for word in (segment.words or [])],
        })
        print(f"PROGRESS {min(85, 10 + round(segment.end / max(info.duration, 1) * 75))}", flush=True)
    print("STATUS TXT 원문과 싱크 정렬 중", flush=True)
    cues = align(lines, segments)
    write_srt(output_path, cues)
    print("PROGRESS 100", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
