import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Delhi Bus Planner — ML-Powered Real-Time Transit & Traffic Model",
  description:
    "Real-time bus travel-time prediction and journey planner for Delhi DTC & Cluster buses, trained on 57M+ GPS telemetry records.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
          crossOrigin=""
        />
      </head>
      <body className="antialiased min-h-screen bg-[#0b0f19] text-gray-100">
        {children}
      </body>
    </html>
  );
}
