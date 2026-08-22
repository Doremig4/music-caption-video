# 자막 영상 생성기

`public/music.mp3`, `public/lyrics.srt`, `public/cover.jpg`를 교체한 뒤 실행.

```bash
npm run web
npm run preview
npm run render
```

TXT 가사 자동 싱크는 최초 한 번 `npm run setup-whisper`를 실행한 뒤 웹에서 사용합니다.

`npm run web` 실행 후 `http://127.0.0.1:4173`에서 파일 업로드, SRT 편집, 렌더를 한 번에 할 수 있습니다.
완성 파일은 `outputs/music-video.mp4`에 저장됩니다. SRT는 UTF-8이어야 하며 마지막 자막은 음악보다 먼저 끝나야 합니다.
