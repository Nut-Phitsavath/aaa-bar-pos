import * as React from 'react'
import { Input } from './input'
import { cn } from '@/lib/utils'

interface FormattedNumberInputProps extends Omit<React.ComponentProps<'input'>, 'type' | 'value' | 'onChange'> {
    value: string | number
    onChange: (value: string) => void
    allowDecimals?: boolean
}

/**
 * FormattedNumberInput - A reusable input component that displays numbers with comma formatting
 * 
 * Features:
 * - Displays numbers with comma separators (e.g., 1,000,000)
 * - Returns raw numeric string value (without commas) via onChange
 * - Supports decimal numbers when allowDecimals is true
 * - Handles edge cases like empty values and invalid input
 * 
 * Usage:
 * <FormattedNumberInput 
 *   value={formData.cost} 
 *   onChange={(val) => setFormData({...formData, cost: val})}
 *   allowDecimals={true}
 * />
 */
export function FormattedNumberInput({
    value,
    onChange,
    allowDecimals = false,
    className,
    ...props
}: FormattedNumberInputProps) {
    const [displayValue, setDisplayValue] = React.useState('')

    // Format number with commas
    const formatNumber = (num: string): string => {
        if (!num) return ''

        // Remove all non-numeric characters except decimal point
        const cleaned = num.replace(/[^\d.]/g, '')

        if (!cleaned) return ''

        // Handle decimals
        if (allowDecimals && cleaned.includes('.')) {
            const [integer, decimal] = cleaned.split('.')
            const formattedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
            return `${formattedInteger}.${decimal}`
        }

        // Format integer part with commas
        return cleaned.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    }

    // Remove commas to get raw number
    const unformatNumber = (formatted: string): string => {
        return formatted.replace(/,/g, '')
    }

    // Update display value when prop value changes
    React.useEffect(() => {
        const numStr = value?.toString() || ''
        setDisplayValue(formatNumber(numStr))
    }, [value, allowDecimals])

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const inputValue = e.target.value

        // Allow empty value
        if (inputValue === '') {
            setDisplayValue('')
            onChange('')
            return
        }

        // Remove commas and validate
        const rawValue = unformatNumber(inputValue)

        // Validate numeric input
        const isValid = allowDecimals
            ? /^\d*\.?\d*$/.test(rawValue)
            : /^\d*$/.test(rawValue)

        if (isValid) {
            setDisplayValue(formatNumber(rawValue))
            onChange(rawValue)
        }
    }

    return (
        <Input
            type="text"
            value={displayValue}
            onChange={handleChange}
            className={cn(className)}
            {...props}
        />
    )
}
