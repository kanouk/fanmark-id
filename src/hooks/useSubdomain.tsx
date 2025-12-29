const getSubdomain = (): string => {
  const hostname = window.location.hostname;
  
  // Development環境での処理
  if (hostname === 'localhost' || hostname.includes('127.0.0.1')) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('admin') === 'true' ? 'admin' : '';
  }
  
  // 本番環境での処理
  const parts = hostname.split('.');
  if (parts.length > 2) {
    return parts[0];
  }
  return '';
};

export const useSubdomain = () => {
  const subdomain = getSubdomain();

  return {
    subdomain,
    isAdmin: subdomain === 'admin',
    isMain: subdomain === '' || subdomain === 'www'
  };
};