'use client';

import { EMPLOYMENT_STATUSES, type EmployeeDto, type EmploymentStatus } from '@businessos/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@businessos/ui';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { EmploymentStatusBadge } from '@/components/phase3/badges';
import { api } from '@/lib/api';
import { useApiErrorMessage } from '@/lib/errors';

/**
 * Inline employment-status control. Read-only badge when the user cannot
 * manage personnel, otherwise a select that patches the employee on change.
 */
export function EmploymentStatusSelect({
  employee,
  canManage,
  onUpdated,
}: {
  employee: EmployeeDto;
  canManage: boolean;
  onUpdated?: () => void | Promise<void>;
}) {
  const t = useTranslations('employmentStatus');
  const tPersonnel = useTranslations('personnel');
  const errorMessage = useApiErrorMessage();

  const mutation = useMutation({
    mutationFn: (employmentStatus: EmploymentStatus) =>
      api.employees.update(employee.id, { employmentStatus }),
    onSuccess: async () => {
      toast.success(tPersonnel('statusChanged'));
      await onUpdated?.();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!canManage) return <EmploymentStatusBadge status={employee.employmentStatus} />;

  return (
    <Select
      value={employee.employmentStatus}
      onValueChange={(value) => mutation.mutate(value as EmploymentStatus)}
      disabled={mutation.isPending}
    >
      <SelectTrigger className="h-8 w-44" aria-label={tPersonnel('changeStatus')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {EMPLOYMENT_STATUSES.map((status) => (
          <SelectItem key={status} value={status}>
            {t(status)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
