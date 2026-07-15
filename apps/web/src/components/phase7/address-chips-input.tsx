'use client';

import { Badge, Input } from '@businessos/ui';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type KeyboardEvent } from 'react';
import { isValidEmailAddress } from './mail-utils';

/**
 * Email addresses as removable chips plus a free-text input. Enter, comma or
 * blur commits the pending text; backspace on an empty input pops the last
 * chip. Invalid addresses surface an inline error instead of being added.
 */
export function AddressChipsInput({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('email.composeDialog');
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState<string | null>(null);

  function commit(raw: string): void {
    const address = raw.trim().toLowerCase().replace(/,$/, '');
    if (address.length === 0) return;
    if (!isValidEmailAddress(address)) {
      setInvalid(address);
      return;
    }
    setInvalid(null);
    if (!value.includes(address)) onChange([...value, address]);
    setText('');
  }

  function remove(address: string): void {
    onChange(value.filter((entry) => entry !== address));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit(text);
    } else if (event.key === 'Backspace' && text.length === 0) {
      const last = value[value.length - 1];
      if (last !== undefined) {
        event.preventDefault();
        remove(last);
      }
    }
  }

  const errorId = `${id}-invalid`;

  return (
    <div className="space-y-2">
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((address) => (
            <Badge key={address} variant="secondary" className="gap-1 font-normal">
              {address}
              {!disabled ? (
                <button
                  type="button"
                  aria-label={t('removeAddress', { address })}
                  className="rounded-sm hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => remove(address)}
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              ) : null}
            </Badge>
          ))}
        </div>
      ) : null}
      <Input
        id={id}
        type="text"
        value={text}
        disabled={disabled}
        autoComplete="off"
        placeholder={t('addressPlaceholder')}
        aria-invalid={invalid !== null ? true : undefined}
        aria-describedby={invalid !== null ? errorId : undefined}
        onChange={(event) => {
          setText(event.target.value);
          if (invalid !== null) setInvalid(null);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => commit(text)}
      />
      {invalid !== null ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {t('invalidAddress', { address: invalid })}
        </p>
      ) : null}
    </div>
  );
}
