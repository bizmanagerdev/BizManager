import type { StatusColor } from "@/lib/ui/status-colors";

export function getStatusColorClasses(color: StatusColor) {
  return {
    success: "bg-green-100 text-green-800 border-green-200",
    warning: "bg-blue-100 text-blue-800 border-blue-200",
    danger: "bg-red-100 text-red-800 border-red-200",
    info: "bg-blue-100 text-blue-800 border-blue-200",
    neutral: "bg-gray-100 text-gray-700 border-gray-200",
  }[color];
}

export function getStatusDotClasses(color: StatusColor) {
  return {
    success: "bg-green-500",
    warning: "bg-blue-500",
    danger: "bg-red-500",
    info: "bg-blue-500",
    neutral: "bg-gray-400",
  }[color];
}

export function getStatusBorderClasses(color: StatusColor) {
  return {
    success: "border-green-300",
    warning: "border-blue-300",
    danger: "border-red-300",
    info: "border-blue-300",
    neutral: "border-gray-300",
  }[color];
}
