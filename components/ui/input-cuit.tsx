"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"
import { formatCUIT, parseCUIT } from "@/lib/format"

interface InputCUITProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string
  onChange: (value: string) => void
}

export function InputCUIT({ value, onChange, ...props }: InputCUITProps) {
  const [displayValue, setDisplayValue] = React.useState("")

  React.useEffect(() => {
    setDisplayValue(formatCUIT(value))
  }, [value])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value
    const formatted = formatCUIT(input)
    setDisplayValue(formatted)
    onChange(parseCUIT(formatted))
  }

  return (
    <Input
      {...props}
      type="text"
      value={displayValue}
      onChange={handleChange}
      maxLength={13}
      placeholder="XX-XXXXXXXX-X"
      className="no-uppercase"
    />
  )
}
