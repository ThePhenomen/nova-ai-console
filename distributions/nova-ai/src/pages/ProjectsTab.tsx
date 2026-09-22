import React from 'react';
import { PageSection, EmptyState, EmptyStateBody } from '@patternfly/react-core';

const ProjectsTab: React.FC = () => (
  <PageSection hasBodyWrapper={false}>
    <EmptyState headingLevel="h2" titleText="No projects yet">
      <EmptyStateBody>Project content will be added here.</EmptyStateBody>
    </EmptyState>
  </PageSection>
);

export default ProjectsTab;
