import { useState } from 'react';
import { Calendar, Clock, Send, CalendarCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface EmailSchedulerProps {
  onScheduleEmail: (scheduledDate: Date) => void;
  onSendNow: () => void;
  className?: string;
  disabled?: boolean;
}

export function EmailScheduler({ 
  onScheduleEmail, 
  onSendNow, 
  className, 
  disabled = false 
}: EmailSchedulerProps) {
  const [isSchedulerOpen, setIsSchedulerOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [selectedTime, setSelectedTime] = useState('09:00');

  // Quick schedule options (in minutes from now)
  const quickScheduleOptions = [
    { label: 'In 1 hour', minutes: 60 },
    { label: 'Tomorrow 9 AM', getDate: () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      return tomorrow;
    }},
    { label: 'Next Monday 9 AM', getDate: () => {
      const nextMonday = new Date();
      const daysUntilMonday = (1 + 7 - nextMonday.getDay()) % 7 || 7;
      nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
      nextMonday.setHours(9, 0, 0, 0);
      return nextMonday;
    }},
    { label: 'In 1 week', getDate: () => {
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);
      return nextWeek;
    }},
  ];

  const handleQuickSchedule = (option: typeof quickScheduleOptions[0]) => {
    let scheduledDate: Date;
    
    if ('minutes' in option && option.minutes !== undefined) {
      scheduledDate = new Date();
      scheduledDate.setMinutes(scheduledDate.getMinutes() + option.minutes);
    } else {
      scheduledDate = option.getDate();
    }
    
    onScheduleEmail(scheduledDate);
    setIsSchedulerOpen(false);
  };

  const handleCustomSchedule = () => {
    if (!selectedDate) {
      return;
    }

    const [hours, minutes] = selectedTime.split(':').map(Number);
    const scheduledDate = new Date(selectedDate);
    scheduledDate.setHours(hours, minutes, 0, 0);
    
    // Validate that the scheduled time is in the future
    if (scheduledDate <= new Date()) {
      alert('Please select a future date and time');
      return;
    }
    
    onScheduleEmail(scheduledDate);
    setIsSchedulerOpen(false);
  };

  const formatScheduledDate = (date: Date) => {
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const isTomorrow = date.toDateString() === new Date(now.getTime() + 86400000).toDateString();
    
    if (isToday) {
      return `Today at ${format(date, 'h:mm a')}`;
    } else if (isTomorrow) {
      return `Tomorrow at ${format(date, 'h:mm a')}`;
    } else {
      return format(date, 'MMM d, yyyy \'at\' h:mm a');
    }
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* Send Now Button */}
      <Button
        onClick={onSendNow}
        disabled={disabled}
        data-testid="button-send-now"
        className="hover-elevate active-elevate-2"
      >
        <Send className="h-4 w-4 mr-2" />
        Send Now
      </Button>

      {/* Schedule Email Button */}
      <Dialog open={isSchedulerOpen} onOpenChange={setIsSchedulerOpen}>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            disabled={disabled}
            data-testid="button-schedule-email"
            className="hover-elevate active-elevate-2"
          >
            <Clock className="h-4 w-4 mr-2" />
            Schedule
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarCheck className="h-5 w-5" />
              Schedule Email
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Quick Schedule Options */}
            <div>
              <Label className="text-sm font-medium">Quick Schedule</Label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {quickScheduleOptions.map((option, index) => (
                  <Button
                    key={index}
                    variant="outline"
                    size="sm"
                    onClick={() => handleQuickSchedule(option)}
                    className="text-xs h-8 hover-elevate active-elevate-2"
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex items-center">
              <div className="flex-1 h-px bg-border"></div>
              <span className="px-2 text-xs text-muted-foreground">OR</span>
              <div className="flex-1 h-px bg-border"></div>
            </div>

            {/* Custom Date and Time */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Custom Schedule</Label>
              
              {/* Date Selection */}
              <div>
                <Label htmlFor="scheduled-date" className="text-xs">Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !selectedDate && "text-muted-foreground"
                      )}
                    >
                      <Calendar className="mr-2 h-4 w-4" />
                      {selectedDate ? format(selectedDate, 'PPP') : 'Select date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      mode="single"
                      selected={selectedDate}
                      onSelect={setSelectedDate}
                      disabled={(date) => {
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        return date < today;
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Time Selection */}
              <div>
                <Label htmlFor="scheduled-time" className="text-xs">Time</Label>
                <Input
                  id="scheduled-time"
                  type="time"
                  value={selectedTime}
                  onChange={(e) => setSelectedTime(e.target.value)}
                  className="w-full"
                />
              </div>

              {/* Preview */}
              {selectedDate && (
                <div className="p-3 bg-muted rounded-md">
                  <div className="text-xs text-muted-foreground">Will send:</div>
                  <div className="font-medium">
                    {(() => {
                      const [hours, minutes] = selectedTime.split(':').map(Number);
                      const previewDate = new Date(selectedDate);
                      previewDate.setHours(hours, minutes, 0, 0);
                      return formatScheduledDate(previewDate);
                    })()}
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setIsSchedulerOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCustomSchedule}
                disabled={!selectedDate}
                data-testid="button-schedule-custom"
              >
                <Clock className="h-4 w-4 mr-2" />
                Schedule Email
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}