
import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import AdminPage from './components/AdminPage';
import PresentationPage from './components/PresentationPage';
import Layout from './components/Layout';

const App: React.FC = () => {
  return (
    <HashRouter>
      <Layout>
        <Routes>
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/presentation" element={<PresentationPage />} />
          <Route path="/" element={<Navigate to="/admin" replace />} />
        </Routes>
      </Layout>
    </HashRouter>
  );
};

export default App;
