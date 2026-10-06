# 자막 영상 생성기

음악과 가사, 커버 이미지로 자막 영상을 만듭니다. 웹에서 파일을 올리고 가사 타이밍을 수정한 뒤 MP4로 저장할 수 있습니다.

```bash
npm install
npm run web
```

[http://127.0.0.1:4173](http://127.0.0.1:4173)에 접속해 시작하세요. TXT 가사를 자동으로 음악에 맞추려면 먼저 `npm run setup-whisper`를 한 번 실행하세요. Python 3가 필요합니다.

완성 영상은 `outputs/music-video.mp4`에 1920×1080, 60fps로 저장됩니다. 빠르게 확인하려면 웹에서 **프록시**를 선택하세요. 960×540 영상이 `outputs/music-video-proxy.mp4`에 저장됩니다. 배경 투명도와 인코딩 방식도 웹에서 조절할 수 있습니다.

터미널에서 작업하려면 `public/music.mp3`, `public/lyrics.srt`, `public/cover.jpg`를 교체한 뒤 아래 명령을 사용하세요.

```bash
npm run preview       # 미리보기
npm run render        # 최종 영상 저장
npm run render:proxy  # 확인용 영상 저장
```

SRT는 UTF-8로 저장하고, 마지막 자막이 음악보다 늦게 끝나지 않도록 해주세요. 렌더링 성능과 하드웨어 인코딩에 관한 내용은 [성능 비교 문서](docs/render-performance.md)를 참고하세요.
