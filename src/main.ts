// 1단계: 배포 확인용 빈 화면. 디자인·게임 로직은 이후 단계에서 구현한다.
import { APP_NAME } from './app/meta';

const root = document.getElementById('app');
if (root) {
  root.textContent = `${APP_NAME} — 준비 중`;
}
