#!/bin/zsh
set -e
cd "$(dirname "$0")"

if ! .whisper-env/bin/python -c 'import faster_whisper' 2>/dev/null; then
  npm run setup-whisper
fi

export HF_HOME="$PWD/.whisper-env/model-cache"
.whisper-env/bin/python - <<'PY'
from pathlib import Path
import subprocess
import sys
import unicodedata

folder = Path('/Users/doremig4/Movies/music lylics caption')
lyrics = next(path for path in folder.glob('*.txt')
              if unicodedata.normalize('NFC', path.name).casefold() == 'if you want 가사.txt')
audio = next(path for path in folder.glob('*.mp3')
             if unicodedata.normalize('NFC', path.name).casefold().startswith('if u want'))
output = folder / 'if you want.srt'
subprocess.run([sys.executable, 'scripts/generate_srt.py', str(audio), str(lyrics), str(output)], check=True)
print(f'저장 완료: {output}')
PY

echo '종료하려면 Enter를 누르세요.'
read
