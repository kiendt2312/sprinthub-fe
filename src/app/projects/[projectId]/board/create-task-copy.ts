import { ApiError, errorMessage } from "@/lib/api";
import type { Profile } from "@/lib/api";
import { selfServeError } from "@/lib/self-serve-copy";

export const createTaskCopy = {
  en: {
    add: "Add task",
    create: "Create task",
    title: "Title",
    cancel: "Cancel",
    creating: "Creating task…",
    archived: "This project is archived.",
    invalidTitle: "Use 1 to 200 characters for the title.",
    unknownOutcome: "The task may have been created. Retry to confirm.",
    retryCreate: "Retry creating task",
    refreshing: "Task created. Refreshing board…",
    readFailed: "Task created, but the board could not be refreshed.",
    retryBoard: "Retry loading board",
  },
  vi: {
    add: "Thêm công việc",
    create: "Tạo công việc",
    title: "Tiêu đề",
    cancel: "Hủy",
    creating: "Đang tạo công việc…",
    archived: "Dự án này đã được lưu trữ.",
    invalidTitle: "Nhập tiêu đề từ 1 đến 200 ký tự.",
    unknownOutcome: "Công việc có thể đã được tạo. Hãy thử lại để xác nhận.",
    retryCreate: "Thử tạo lại công việc",
    refreshing: "Đã tạo công việc. Đang tải lại bảng…",
    readFailed: "Đã tạo công việc nhưng không tải lại được bảng.",
    retryBoard: "Thử tải lại bảng",
  },
} satisfies Record<Profile["locale"], Record<string, string>>;

export function createTaskError(error: unknown, locale: Profile["locale"]) {
  const code = error instanceof ApiError ? error.code : "";
  if (code === "VALIDATION_FAILED") return createTaskCopy[locale].invalidTitle;
  if (code === "PROJECT_ARCHIVED") return createTaskCopy[locale].archived;
  if (locale === "en") return errorMessage(error);
  if (code === "COLUMN_FULL") return "Cột việc cần làm đã đầy.";
  return selfServeError(locale, code);
}
