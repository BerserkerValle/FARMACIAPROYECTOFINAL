import { useState, useRef, useEffect, type InputHTMLAttributes, type ForwardedRef } from 'react';

export interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  error?: string;
  hint?: string;
  showStrength?: boolean;
}

const PasswordInput = (props: PasswordInputProps, ref: ForwardedRef<HTMLInputElement>) => {
  const {
    label,
    error,
    hint,
    showStrength = false,
    className = '',
    id,
    'aria-describedby': ariaDescribedBy,
    ...inputProps
  } = props;

  const [showPassword, setShowPassword] = useState(false);
  const [strength, setStrength] = useState<'weak' | 'medium' | 'strong' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const generatedId = useRef(`pwd-${Math.random().toString(36).substr(2, 9)}`);
  const inputId = id || generatedId.current;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const strengthId = `${inputId}-strength`;

  useEffect(() => {
    if (ref) {
      if (typeof ref === 'function') {
        ref(inputRef.current);
      } else {
        ref.current = inputRef.current!;
      }
    }
  }, [ref]);

  const toggleVisibility = () => {
    setShowPassword(prev => !prev);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (showStrength) {
      setStrength(calculateStrength(value));
    }
    if (inputProps.onChange) {
      inputProps.onChange(e);
    }
  };

  const describedBy = [
    error && errorId,
    hint && hintId,
    showStrength && strength && strengthId,
    ariaDescribedBy
  ].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`password-input-wrapper ${className}`}>
      {label && (
        <label htmlFor={inputId} className="password-input-label">
          {label}
          {inputProps.required && <span className="required-indicator" aria-hidden="true">*</span>}
        </label>
      )}
      <div className="password-input-container">
        <input
          ref={inputRef}
          id={inputId}
          type={showPassword ? 'text' : 'password'}
          className={`password-input ${error ? 'has-error' : ''}`}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={describedBy}
          onChange={handleChange}
          {...inputProps}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={toggleVisibility}
          aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          aria-pressed={showPassword}
          tabIndex={-1}
        >
          {showPassword ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>

      {error && (
        <p id={errorId} className="password-input-error" role="alert" aria-live="polite">
          {error}
        </p>
      )}

      {hint && !error && (
        <p id={hintId} className="password-input-hint">
          {hint}
        </p>
      )}

      {showStrength && strength && (
        <div id={strengthId} className="password-strength" role="progressbar" aria-valuenow={strength === 'weak' ? 33 : strength === 'medium' ? 66 : 100} aria-valuemin={0} aria-valuemax={100} aria-label={`Fortaleza de contraseña: ${strength}`}>
          <div className="password-strength-bar">
            <span className={`password-strength-fill ${strength}`}></span>
          </div>
          <span className={`password-strength-text ${strength}`}>
            {strength === 'weak' && 'Débil: agrega mayúsculas, números y símbolos'}
            {strength === 'medium' && 'Media: casi cumple los requisitos'}
            {strength === 'strong' && 'Fuerte: contraseña segura'}
          </span>
        </div>
      )}
    </div>
  );
};

function calculateStrength(password: string): 'weak' | 'medium' | 'strong' | null {
  if (!password) return null;
  
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[!@#$%^&*]/.test(password)) score++;
  
  if (score <= 2) return 'weak';
  if (score <= 4) return 'medium';
  return 'strong';
}

export const PasswordInputComponent = Object.assign(PasswordInput, {
  displayName: 'PasswordInput'
});

export default PasswordInputComponent;