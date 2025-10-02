import React, { useState, useEffect } from 'react';

export const useSubdomain = () => {
  const [subdomain, setSubdomain] = useState<string>('');

  useEffect(() => {
    const hostname = window.location.hostname;
    
    // Development環境での処理
    if (hostname === 'localhost' || hostname.includes('127.0.0.1')) {
      // URLパラメータでサブドメインをシミュレート
      const urlParams = new URLSearchParams(window.location.search);
      const adminParam = urlParams.get('admin');
      setSubdomain(adminParam === 'true' ? 'admin' : '');
      return;
    }
    
    // 本番環境での処理
    const parts = hostname.split('.');
    if (parts.length > 2) {
      setSubdomain(parts[0]);
    } else {
      setSubdomain('');
    }
  }, []);

  return {
    subdomain,
    isAdmin: subdomain === 'admin',
    isMain: subdomain === '' || subdomain === 'www'
  };
};