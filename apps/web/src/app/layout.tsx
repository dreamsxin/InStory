import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "InStory",
  description: "AI 驱动互动小说平台"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
