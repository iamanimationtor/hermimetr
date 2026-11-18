/** The historical field name is misleading: draft rows are excluded, not included. */
export function estimateDraftDisclosure(projectSnapshot: Record<string, unknown>): string {
  const count = projectSnapshot.includedDraftRows;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    return "تعداد ردیف‌های پیش‌نویسِ خارج از این نسخه در داده‌های نسخه ثبت نشده است.";
  }
  return count === 0
    ? "در زمان ثبت این نسخه هیچ ردیف پیش‌نویسی در پروژه ثبت نشده بود. این موضوع کامل‌بودن دامنه پروژه را تضمین نمی‌کند."
    : `${count} ردیف پیش‌نویس در زمان ثبت نسخه از این برآورد کنار گذاشته شد؛ این مبلغ برآورد کامل پروژه نیست.`;
}
