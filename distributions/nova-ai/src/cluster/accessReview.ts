import { k8sRequest } from './k8sClient';

type SelfSubjectAccessReview = {
  status?: {
    allowed?: boolean;
  };
};

export const canI = async (
  verb: string,
  group: string,
  resource: string,
  namespace?: string,
): Promise<boolean> => {
  try {
    const review = await k8sRequest<SelfSubjectAccessReview>(
      '/apis/authorization.k8s.io/v1/selfsubjectaccessreviews',
      {
        method: 'POST',
        body: {
          apiVersion: 'authorization.k8s.io/v1',
          kind: 'SelfSubjectAccessReview',
          spec: {
            resourceAttributes: {
              verb,
              group,
              resource,
              ...(namespace ? { namespace } : {}),
            },
          },
        },
      },
    );
    return review.status?.allowed === true;
  } catch {
    return false;
  }
};
