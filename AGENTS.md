# Agent Instructions — sprinthub-fe (thư mục local: sprinthub-ui)

Next.js app cho user của **SprintHub**. Repo trung tâm là `../sprinthub-be`: mở
session ở đó; đọc `../sprinthub-be/AGENTS.md` và `../sprinthub-be/docs/REPOSITORIES.md`.

Trạng thái: **chưa scaffold**. UI sẽ được thiết kế qua Figma trước; thư viện FE
chốt sau.

## Quy tắc

- **Contract sửa ở BE trước.** Contract nằm ở
  `../sprinthub-be/openspec/changes/<change>/contract.md`; type sinh từ
  `openapi.json` của BE bằng `openapi-typescript`, không viết tay type API.
- **Song ngữ EN/VI:** BE trả lỗi dạng `code` + `params`, FE dịch bằng catalog
  `en`/`vi`. Ngôn ngữ lấy từ `user.locale`; chỉ trang landing có prefix URL.
- **Mutation queue theo task:** mỗi task tối đa 1 request đang bay; mỗi mutation có
  `X-Client-Mutation-Id` và `Idempotency-Key`; bỏ event có `seq ≤ lastSeq`.
- **Realtime bằng SSE** (`/api/v1/events`, `Last-Event-ID` = `seq`), không WebSocket.
- **Markdown** (description, comment) render có sanitize.
- **Không phân quyền bằng ẩn nút**; quyền thật do BE quyết định.
- Gọi API cùng origin qua Next.js rewrite `/api/*`.

## Git

Trunk-based, public, MIT. Danh tính commit: `kiendt <kiendt2312.work@gmail.com>`.
Không push hay tạo PR khi chưa được yêu cầu.
