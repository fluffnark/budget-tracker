import { Navigate, useParams } from 'react-router-dom';

import { getWorkspaceSection } from '../workspace/sections';

export function WorkspacePage() {
  const { sectionId } = useParams();
  const activeSection = getWorkspaceSection(sectionId);

  if (sectionId && activeSection.id !== sectionId) {
    return <Navigate to={`/${activeSection.id}`} replace />;
  }

  return (
    <div className="workspace-focus">
      <section className="workspace-stage" key={activeSection.id}>
        {activeSection.render()}
      </section>
    </div>
  );
}
