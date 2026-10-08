'use client'

import { useState, useTransition } from 'react'
import { Mail, Trash2, UserPlus, Send } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { addFamilyMember, removeFamilyMember, resendFamilyInvite } from '@/actions/family'

interface FamilyMember {
  id: string
  name: string | null
  email: string | null
  createdAt: string
}

interface FamilyManagementProps {
  initialMembers: FamilyMember[]
}

export const FamilyManagement = ({ initialMembers }: FamilyManagementProps) => {
  const [members, setMembers] = useState(initialMembers)
  const [isPending, startTransition] = useTransition()
  const [actionId, setActionId] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const handleAdd = () => {
    if (!name.trim() || !email.trim()) {
      setError('Name and email are required')
      return
    }

    setError('')
    setSuccessMsg('')
    startTransition(async () => {
      const result = await addFamilyMember({ name: name.trim(), email: email.trim() })
      if (result.success) {
        setName('')
        setEmail('')
        setShowAddForm(false)
        if (result.data?.emailSent === false) {
          setSuccessMsg(
            'Family member added, but the invite email could not be sent. Try resending.'
          )
        } else {
          setSuccessMsg(`Invite sent to ${email.trim()}`)
        }
        // Refresh will pick up the new member if they already had an account
        window.location.reload()
      } else {
        setError(result.error ?? 'Failed to add family member')
      }
    })
  }

  const handleRemove = (userId: string) => {
    setActionId(userId)
    setSuccessMsg('')
    startTransition(async () => {
      const result = await removeFamilyMember({ userId })
      if (result.success) {
        setMembers((prev) => prev.filter((m) => m.id !== userId))
      }
      setActionId(null)
    })
  }

  const handleResend = (userId: string) => {
    setActionId(userId)
    setSuccessMsg('')
    startTransition(async () => {
      const result = await resendFamilyInvite({ userId })
      if (result.success) {
        if (result.data?.emailSent === false) {
          setError('Could not send the invite email. Please try again later.')
        } else {
          setSuccessMsg('Booking invite resent!')
        }
      }
      setActionId(null)
    })
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })

  return (
    <div className="space-y-6">
      {/* Success message */}
      {successMsg && (
        <div className="p-3 bg-forest-50 dark:bg-forest-900/30 border border-forest-200 dark:border-forest-800 rounded-lg text-sm text-forest-700 dark:text-forest-300">
          {successMsg}
        </div>
      )}

      {/* Add form */}
      {showAddForm ? (
        <div className="bg-card rounded-xl border border-border p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Invite Family Member</h2>
          <p className="text-sm text-muted-foreground">
            They&apos;ll receive an email with a link to book without payment.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="family-name"
                className="block text-sm font-medium text-foreground mb-1"
              >
                Name
              </label>
              <input
                id="family-name"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                }}
                placeholder="Jane Doe"
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-forest-500 focus:border-forest-500"
              />
            </div>
            <div>
              <label
                htmlFor="family-email"
                className="block text-sm font-medium text-foreground mb-1"
              >
                Email
              </label>
              <input
                id="family-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                }}
                placeholder="jane@example.com"
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-forest-500 focus:border-forest-500"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3">
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <Button
              onClick={handleAdd}
              isLoading={isPending}
              disabled={!name.trim() || !email.trim()}
            >
              <Mail className="h-4 w-4 mr-1.5" />
              Send Invite
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setShowAddForm(false)
                setError('')
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          onClick={() => {
            setShowAddForm(true)
          }}
        >
          <UserPlus className="h-4 w-4 mr-1.5" />
          Add Family Member
        </Button>
      )}

      {/* Members list */}
      {members.length === 0 ? (
        <div className="text-center py-12 bg-card rounded-xl border border-border">
          <p className="text-muted-foreground">No family members yet.</p>
          <p className="text-sm text-muted-foreground mt-1">
            Add family members so they can book without needing to pay.
          </p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="divide-y divide-border">
            {members.map((member) => (
              <div key={member.id} className="p-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium text-foreground truncate">{member.name ?? 'Unknown'}</p>
                  <p className="text-sm text-muted-foreground truncate">{member.email}</p>
                  <p className="text-xs text-muted-foreground">
                    Added {formatDate(member.createdAt)}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      handleResend(member.id)
                    }}
                    disabled={isPending && actionId === member.id}
                    title="Resend booking invite"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      handleRemove(member.id)
                    }}
                    disabled={isPending && actionId === member.id}
                    title="Remove family member"
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
