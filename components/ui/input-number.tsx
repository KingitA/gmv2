"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"
import { formatNumber, parseFormattedNumber } from "@/lib/format"

interface InputNumberProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: number | string
  onChange: (value: number) => void
  decimals?: number
}

export function InputNumber({ value, onChange, decimals = 2, ...props }: InputNumberProps) {
  const [displayValue, setDisplayValue] = React.useState("")

  React.useEffect(() => {
    const num = typeof value === "string" ? Number.parseFloat(value) : value
    if (!isNaN(num)) {
      setDisplayValue(formatNumber(num, decimals))
    }
  }, [value, decimals])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value

    // Permitir solo números, punto y coma
    const cleaned = input.replace(/[^\d.,]/g, "")
    setDisplayValue(cleaned)
  }

  const handleBlur = () => {
    const num = parseFormattedNumber(displayValue)
    onChange(num)
    setDisplayValue(formatNumber(num, decimals))
  }

  return (
    <Input
      {...props}
      type="text"
      value={displayValue}
      onChange={handleChange}
      onBlur={handleBlur}
      className="no-uppercase"
    />
  )
}
