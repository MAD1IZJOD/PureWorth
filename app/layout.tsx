import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PureWorth — Good groceries. Better math.",
  description: "Compare your complete grocery basket, including delivery and fees. Explore PureWorth with clearly labeled demonstration data and fictional stores.",
  applicationName: "PureWorth",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-IN"><body>{children}</body></html>;
}
