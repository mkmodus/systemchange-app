
import React from 'react';

const LOGO_URL = 'https://cdn.prod.website-files.com/6560be4e64c0b2220d95cecc/6560c9eba1fb7d6fee624fdd_img_logo_top_120px.svg';

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col relative">
      <header className="fixed top-0 left-0 p-6 z-50">
        <img 
          src={LOGO_URL} 
          alt="Logo" 
          className="h-8 md:h-10 invert brightness-200"
        />
      </header>
      <main className="flex-grow pt-24 px-4 md:px-8 max-w-7xl mx-auto w-full">
        {children}
      </main>
    </div>
  );
};

export default Layout;
