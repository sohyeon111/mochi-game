# Mochi Game

웹캠과 얼굴 인식(MediaPipe)으로 입을 벌려 과일 재료를 모으고, 완성된 찹쌀떡을 늘리고 만지는 웹 미니게임.

- 기획/규칙: [SPEC.md](./SPEC.md)
- 개발 가이드: [CLAUDE.md](./CLAUDE.md)

## 개발
```
npm install
npm run dev      # 개발 서버
npm test         # 단위 테스트
npm run build    # 프로덕션 빌드
```

`main`에 푸시하면 GitHub Actions가 테스트 → 빌드 → GitHub Pages 배포를 수행한다.
