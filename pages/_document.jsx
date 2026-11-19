import { Html, Head, Main, NextScript } from 'next/document';

// Applies the saved theme before first paint (no white flash in dark mode)
const themeScript = `try{var s=JSON.parse(localStorage.getItem('cc_settings')||'{}');var t=s.theme||'system';
if(t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;

export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
