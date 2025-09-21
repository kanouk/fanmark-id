import { useState, useEffect } from 'react';

interface FanmarkSessionData {
  searchQuery: string;
  timestamp: number;
}

export const useFanmarkSession = () => {
  const [sessionData, setSessionData] = useState<FanmarkSessionData | null>(null);

  // Store search data for non-logged-in users
  const storeSearchData = (searchQuery: string) => {
    const data: FanmarkSessionData = {
      searchQuery,
      timestamp: Date.now(),
    };
    localStorage.setItem('fanmark_search_session', JSON.stringify(data));
    setSessionData(data);
  };

  // Retrieve and clear session data after signup
  const retrieveAndClearSessionData = (): string | null => {
    const stored = localStorage.getItem('fanmark_search_session');
    if (stored) {
      try {
        const data: FanmarkSessionData = JSON.parse(stored);
        // Only use data if it's less than 30 minutes old
        if (Date.now() - data.timestamp < 30 * 60 * 1000) {
          localStorage.removeItem('fanmark_search_session');
          return data.searchQuery;
        }
      } catch (error) {
        console.error('Error parsing session data:', error);
      }
      localStorage.removeItem('fanmark_search_session');
    }
    return null;
  };

  // Check if there's existing session data on mount
  useEffect(() => {
    const stored = localStorage.getItem('fanmark_search_session');
    if (stored) {
      try {
        const data: FanmarkSessionData = JSON.parse(stored);
        if (Date.now() - data.timestamp < 30 * 60 * 1000) {
          setSessionData(data);
        } else {
          localStorage.removeItem('fanmark_search_session');
        }
      } catch (error) {
        console.error('Error parsing session data:', error);
        localStorage.removeItem('fanmark_search_session');
      }
    }
  }, []);

  return {
    sessionData,
    storeSearchData,
    retrieveAndClearSessionData,
  };
};