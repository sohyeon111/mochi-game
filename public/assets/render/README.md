# public/assets/render — Blender 렌더 에셋

원본 `design/assets/mochi_assets.blend`(수정하지 않음)의 **기존 모델을 복사본에서 렌더**한 투명 WebP와 게임용 데이터. 새로 모델링한 것은 없다.
재생성: `scripts/blender/render_assets.py` → `build_asset_data.py` → `verify_assets.py` (설정·선택 이유: `design/test-renders/mochi_final/RESULTS.md`)

## 파일 이름 규칙
`{종류}_{게임ID}_{시점}.webp` — 종류: `mochi`/`fruit`/`trash`, 시점: `front`(정면 고도 21°), `top`(위에서 수직)

## 에셋 목록과 용도
| 파일 | 크기(px) | 용도 | 원본 Blender 오브젝트 |
|---|---|---|---|
| `mochi/mochi_skin_front.webp` | 1134×859 | 떡 막(앞면) 정면. 과일 레이어 **위**에 그린다 | `Mochi` |
| `mochi/mochi_back_front.webp` | 1134×859 | 떡 뒷벽 정면. 과일 레이어 **아래**에 그린다(막과 같은 크기·정렬) | `Mochi` |
| `mochi/mochi_skin_top.webp` | 1142×1142 | 떡 막 위 시점(MOCHI_TOUCH) | `Mochi` |
| `mochi/mochi_back_top.webp` | 1142×1142 | 떡 뒷벽 위 시점 | `Mochi` |
| `fruits/fruit_strawberry_{front,top}.webp` | 261×366 / 267×268 | 딸기. 떨어지는 오브젝트(front) + 떡 내부 조각(front/top) | `strawberry` |
| `fruits/fruit_kiwi_{front,top}.webp` | 410×351 / 416×360 | 키위(단면). top은 단면이 위를 보도록 눕혀 렌더 | `kiwi` |
| `fruits/fruit_orange_{front,top}.webp` | 305×280 / 314×314 | **오렌지**(표기). 모델은 귤 | `tangerine` |
| `fruits/fruit_blueberry_{front,top}.webp` | 397×332 / 414×253 | 블루베리(3알 묶음 1개 = 1개 획득) | `blueberry` |
| `trash/trash_can_front.webp` | 274×357 | 캔 | `can` |
| `trash/trash_sock_front.webp` | 379×442 | 양말 | `sock` |
| `trash/trash_fishbone_front.webp` | 651×237 | 생선뼈 | `fishbone` |
| `trash/trash_newspaper_front.webp` | 481×329 | 신문지 | `newspaper` |

## 데이터 파일
| 파일 | 내용 |
|---|---|
| `manifest.json` | 전체 에셋 목록(이름, 시점, 용도, 크기, 용량, 원본 오브젝트, 렌더 프레임에서의 자른 위치) |
| `collision.json` | 오브젝트 8종의 **실루엣 기준 충돌 형상**(여러 개의 원), 무게중심, 여백 제거 정보, `hitScale` |
| `mochi.json` | 시점별 실루엣/보정값, 소프트바디 외곽 링(32점), 공통 워프 메시(22×18, 평균값 좌표 가중치), 내부 과일 배치 파라미터 |

## 사용 규칙
- 좌표는 모두 **여백을 제거한 스프라이트 px** 기준이다. 렌더 프레임 기준 위치는 `manifest.json`의 `cropOriginInFrame`.
- 과일 스프라이트는 같은 카메라·조명으로 렌더되어 있어, 떨어지는 오브젝트와 떡 내부 조각에 같은 파일을 쓴다. 떡 내부 조각은 게임에서 흐림·색 섞임을 적용한다.
- 오브젝트의 크기/기울기/회전은 Canvas에서 적용하고 충돌 형상도 같은 변환을 따른다.
- Blender의 `banana`, `apple`은 게임 규칙에 없어 렌더하지 않았다.
