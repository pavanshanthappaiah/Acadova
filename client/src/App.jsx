import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/common/ProtectedRoute';
import AppLayout from './components/layout/AppLayout';
import IntroSplash from './components/common/IntroSplash';
import Login from './pages/Login';
import Register from './pages/Register';
import OidcCallback from './pages/OidcCallback';
import Dashboard from './pages/Dashboard';
import Academics from './pages/Academics';
import ProjectsPage from './pages/ProjectsPage';
import ProblemsPage from './pages/ProblemsPage';
import ProductivityRadar from './pages/ProductivityRadar';
import MyRoutine from './pages/MyRoutine';
import Settings from './pages/Settings';
import Legal from './pages/Legal';

export const App = () => {
  return (
    <AuthProvider>
      {/* Plays once per session on entry, then hands over to the app. */}
      <IntroSplash />
      <BrowserRouter>
        <Routes>
          {/* Public authentication routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/oidc/callback" element={<OidcCallback />} />
          <Route path="/legal/:doc" element={<Legal />} />

          {/* Protected application routes */}
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Dashboard />} />
              {/* "Plan your day" was removed — My Day (/routine) covers classes
                  and personal routines in one place. */}
              <Route path="/academics" element={<Academics />} />
              {/* Growth = Projects + Problems (the combined Skills & Projects
                  page was split into these two sections; /technical-growth
                  redirects for old links). */}
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/problems" element={<ProblemsPage />} />
              <Route path="/technical-growth" element={<Navigate to="/problems" replace />} />
              <Route path="/productivity" element={<ProductivityRadar />} />
              <Route path="/routine" element={<MyRoutine />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
          </Route>

          {/* Catch-all redirect */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;
