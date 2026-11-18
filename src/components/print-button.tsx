"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return <button type="button" className="report-print-button" onClick={() => window.print()}><Printer size={18} /> چاپ / ذخیره PDF</button>;
}
