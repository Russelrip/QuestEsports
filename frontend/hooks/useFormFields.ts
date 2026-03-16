"use client";

import { useCallback, useState } from "react";

type FieldElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export function useFormFields<T>(initialState: T) {
  const [fields, setFields] = useState<T>(initialState);

  const updateField = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setFields((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const handleFieldChange = useCallback(
    (event: React.ChangeEvent<FieldElement>) => {
      const target = event.target;
      const { name, type } = target;

      if (type === "checkbox") {
        updateField(
          name as keyof T,
          (target as HTMLInputElement).checked as T[keyof T]
        );
        return;
      }

      if (type === "file") {
        const files = (target as HTMLInputElement).files;
        updateField(
          name as keyof T,
          (files && files.length > 0 ? files[0] : null) as T[keyof T]
        );
        return;
      }

      updateField(name as keyof T, target.value as T[keyof T]);
    },
    [updateField]
  );

  const resetFields = useCallback(
    (nextState: T = initialState) => {
      setFields(nextState);
    },
    [initialState]
  );

  return {
    fields,
    setFields,
    updateField,
    handleFieldChange,
    resetFields,
  };
}
