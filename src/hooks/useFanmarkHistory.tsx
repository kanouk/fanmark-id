import { useState, useEffect } from "react";

export interface FanmarkHistoryItem {
  emoji: string;
  shortId: string;
  searchedAt: number;
}

const STORAGE_KEY = "fanmark_search_history";
const MAX_HISTORY_ITEMS = 20;

export const useFanmarkHistory = () => {
  const [history, setHistory] = useState<FanmarkHistoryItem[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setHistory(parsed);
      } catch (error) {
        console.error("Failed to parse fanmark history:", error);
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  const addToHistory = (emoji: string, shortId: string) => {
    const newItem: FanmarkHistoryItem = {
      emoji,
      shortId,
      searchedAt: Date.now(),
    };

    const filtered = history.filter((item) => item.shortId !== shortId);
    const newHistory = [newItem, ...filtered].slice(0, MAX_HISTORY_ITEMS);

    setHistory(newHistory);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const removeItem = (shortId: string) => {
    const newHistory = history.filter((item) => item.shortId !== shortId);
    setHistory(newHistory);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
  };

  return { history, addToHistory, clearHistory, removeItem };
};
