declare module '*.png' {
  const value: string;
  export default value;
}

declare module '*.svg' {
  const value: string;
  export default value;
}

declare module '*.jpg' {
  const value: string;
  export default value;
}

declare module '*.gif' {
  const value: string;
  export default value;
}

declare namespace NodeJS {
  interface ProcessEnv {
    PRODUCT_NAME?: string;
    STARVAULT_OIDC_ISSUER?: string;
    STARVAULT_OIDC_CLIENT_ID?: string;
    STARVAULT_OIDC_SCOPES?: string;
    STARVAULT_OIDC_REDIRECT_URI?: string;
    KUBECONFIG_API_SERVER?: string;
  }
}
