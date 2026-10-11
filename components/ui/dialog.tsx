'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50',
        className,
      )}
      {...props}
    />
  )
}

type DialogSize = "sm" | "lg" | "xl" | "full"

function DialogContent({
  className,
  children,
  showCloseButton = true,
  size = "lg",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  size?: DialogSize
}) {
  const sizeClassMap: Record<DialogSize, string> = {
    sm: "sm:max-w-lg",
    lg: "sm:max-w-3xl",
    xl: "sm:max-w-7xl",
    full: "sm:max-w-none",
  }

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogTitle></DialogTitle>
      <DialogPrimitive.Content
        // On close Radix hands focus back to the dialog's trigger, and focusing
        // an element scrolls it into view. Dialogs here are usually opened from
        // state (an edit button on a card) rather than from their own trigger,
        // so the trigger Radix knows about is whatever sits at the top of the
        // page -- and closing yanks the till back up there, losing the staff
        // member's place in a long list.
        //
        // Trade-off: focus falls to <body> instead of returning to a control,
        // so a keyboard user restarts tabbing from the top of the document.
        // Placed before {...props} so a caller that needs the focus return can
        // pass its own onCloseAutoFocus.
        onCloseAutoFocus={(e) => e.preventDefault()}
        // A toast is portalled to <body>, so it sits outside this content and
        // Radix counts a tap on it as "interacted outside" -- which dismisses
        // the dialog underneath. Other portals (Select, Popover) are Radix
        // dismissable layers and are excluded from that by the layer stack;
        // sonner is not, so it needs saying explicitly.
        //
        // This is not a cosmetic dismissal. Error toasts never auto-clear by
        // design, so the one toast guaranteed to be tapped by hand is the one
        // raised over a half-filled form -- and tapping it took the form with
        // it. Placed before {...props} so a caller can still override.
        onInteractOutside={(e) => {
          const target = e.target as Element | null
          if (target?.closest?.("[data-sonner-toaster]")) e.preventDefault()
        }}
        className={cn(
          `
          fixed left-1/2 top-1/2 z-50
          w-[95vw]
          max-w-[calc(100%-2rem)]
          -translate-x-1/2 -translate-y-1/2
          grid gap-4 rounded-lg border
          bg-background p-6 shadow-lg
          max-h-[95vh] overflow-y-auto
          `,
          sizeClassMap[size],
          className
        )}
        {...props}
      >
        {children}

        {showCloseButton && (
          <DialogPrimitive.Close
            className="absolute top-4 right-4 rounded opacity-70 hover:opacity-100 focus:outline-none"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-2 text-center sm:text-left', className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-lg leading-none font-semibold', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
