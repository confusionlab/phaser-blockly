import { Routes, Route } from 'react-router-dom';
import { EditorLayout } from './components/layout/EditorLayout';
import { DebugPanel } from './components/debug/DebugPanel';

function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<EditorLayout />} />
        <Route path="/project/:projectId" element={<EditorLayout />} />
      </Routes>
      <DebugPanel />
    </>
  );
}

export default App;
