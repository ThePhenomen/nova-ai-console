import React from 'react';
import { EmptyState, EmptyStateBody, PageSection } from '@patternfly/react-core';

type PlaceholderTabProps = {
  title: string;
  description: string;
};

const PlaceholderTab: React.FC<PlaceholderTabProps> = ({ title, description }) => (
  <PageSection>
    <EmptyState headingLevel="h2" titleText={title}>
      <EmptyStateBody>{description}</EmptyStateBody>
    </EmptyState>
  </PageSection>
);

export default PlaceholderTab;
