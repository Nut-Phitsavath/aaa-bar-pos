import * as React from 'react'
import { Input } from './input'
import { cn } from '@/lib/utils'

interface FormattedTextInputProps extends Omit<React.ComponentProps<'input'>, 'type' | 'onChange'> {
    value: string
    onChange: (value: string) => void
}

/**
 * FormattedTextInput - A reusable text input component for consistency
 * 
 * Features:
 * - Simple text input wrapper
 * - Provides standardized interface matching FormattedNumberInput
 * - Maintains consistency across form inputs
 * 
 * Usage:
 * <FormattedTextInput 
 *   value={formData.name} 
 *   onChange={(val) => setFormData({...formData, name: val})}
 * />
 */
export function FormattedTextInput({
    value,
    onChange,
    className,
    ...props
}: FormattedTextInputProps) {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onChange(e.target.value)
    }

    return (
        <Input
            type="text"
            value={value}
            onChange={handleChange}
            className={cn(className)}
            {...props}
        />
    )
}
