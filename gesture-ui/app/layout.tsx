import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "조아용 곡선택",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, background: "black", overflow: "hidden" }}>
        {children}
      </body>
    </html>
  );
}
