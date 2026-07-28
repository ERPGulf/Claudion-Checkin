/* eslint-disable react/prop-types */
import { View, Text } from 'react-native';
import { Image } from 'expo-image';
import React, { useEffect, useState, useRef } from 'react';
import { useSelector } from 'react-redux';
import { differenceInSeconds } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import Card from '../common/Card';
import checkinimg from '../../assets/images/checkin.png';
import checkoutimg from '../../assets/images/checkout.png';
import {
  selectCheckin,
  selectCheckinTime,
  selectLocation,
  selectTodayHours,
  selectMonthlyHours,
  selectBreakMinutes,
} from '../../redux/Slices/AttendanceSlice';

/**
 * Modern counterpart to AttendanceAction/WelcomeCard.
 *
 * Identical data and identical live-timer behaviour — the two `differenceInSeconds`
 * intervals are copied verbatim — but presented as a light dashboard card instead
 * of a 240pt black block: one hero value (time worked), a status badge, and the
 * remaining figures as a labelled stat row.
 *
 * WelcomeCard is left untouched for the classic screen.
 */
function StatusCard() {
  const { colors } = useAppTheme();
  const location = useSelector(selectLocation);
  const checkin = useSelector(selectCheckin);
  const checkinTime = useSelector(selectCheckinTime);

  const todayTotal = useSelector(selectTodayHours);
  const monthlyTotal = useSelector(selectMonthlyHours);
  const breakMinutes = useSelector(selectBreakMinutes);
  const onBreak = useSelector(state => state.attendance.onBreak);
  const breakStartTime = useSelector(state => state.attendance.breakStartTime);
  const [liveBreakMinutes, setLiveBreakMinutes] = useState(0);
  const breakIntervalRef = useRef(null);
  const [sessionMinutes, setSessionMinutes] = useState(0);
  const intervalRef = useRef(null);

  const formatMinutes = totalMinutes => {
    const safeMinutes = Math.floor(Number(totalMinutes) || 0);

    const hours = Math.floor(safeMinutes / 60);
    const minutes = safeMinutes % 60;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  };

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!checkin || !checkinTime) {
      setSessionMinutes(0);
      return;
    }

    const parsed = new Date(checkinTime);

    const update = () => {
      const seconds = differenceInSeconds(new Date(), parsed);
      const minutes = Math.floor(seconds / 60);
      setSessionMinutes(minutes);
    };

    update();
    intervalRef.current = setInterval(update, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [checkin, checkinTime]);

  useEffect(() => {
    if (breakIntervalRef.current) {
      clearInterval(breakIntervalRef.current);
      breakIntervalRef.current = null;
    }

    // If not on break → no live timer
    if (!onBreak || !breakStartTime) {
      setLiveBreakMinutes(0);
      return;
    }

    const parsed = breakStartTime ? new Date(breakStartTime) : null;
    if (!parsed) return;

    const updateBreak = () => {
      const seconds = differenceInSeconds(new Date(), parsed);
      const minutes = Math.floor(seconds / 60);
      setLiveBreakMinutes(minutes);
    };

    updateBreak();
    breakIntervalRef.current = setInterval(updateBreak, 1000);

    return () => {
      if (breakIntervalRef.current) clearInterval(breakIntervalRef.current);
    };
  }, [onBreak, breakStartTime]);

  const badgeTone = checkin ? 'success' : 'info';

  return (
    <Card padded>
      {/* -------- status badge + illustration -------- */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flex: 1, paddingEnd: SPACING.md }}>
          <View
            style={{
              alignSelf: 'flex-start',
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: SPACING.sm + 2,
              paddingVertical: 5,
              borderRadius: RADIUS.pill,
              backgroundColor: colors[`${badgeTone}Surface`],
            }}
          >
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: colors[`${badgeTone}Text`],
                marginEnd: SPACING.xs + 2,
              }}
            />
            <Text
              style={{
                ...TYPO.caption2,
                fontWeight: '700',
                letterSpacing: 0.6,
                color: colors[`${badgeTone}Text`],
              }}
            >
              {checkin ? 'CHECKED IN' : 'NOT CHECKED IN'}
            </Text>
          </View>

          {checkin ? (
            <>
              <Text
                style={{
                  ...TYPO.caption,
                  color: colors.textMuted,
                  marginTop: SPACING.md,
                }}
              >
                Working from
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginTop: 2,
                }}
              >
                <Ionicons
                  name="business-outline"
                  size={ICON.sm}
                  color={colors.textSecondary}
                />
                <Text
                  numberOfLines={1}
                  style={{
                    ...TYPO.headline,
                    color: colors.textPrimary,
                    marginStart: SPACING.xs + 2,
                    flexShrink: 1,
                  }}
                >
                  {location?.locationName ?? 'Office'}
                </Text>
              </View>

              <Text
                style={{
                  ...TYPO.caption,
                  color: colors.textMuted,
                  marginTop: SPACING.md,
                }}
              >
                You have been working for
              </Text>
              <Text
                style={{
                  ...TYPO.title1,
                  color: colors.textPrimary,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {formatMinutes(sessionMinutes)}
                <Text style={{ ...TYPO.subhead, color: colors.textMuted }}>
                  {'  Hours'}
                </Text>
              </Text>
            </>
          ) : (
            <>
              <Text
                style={{
                  ...TYPO.title3,
                  color: colors.textPrimary,
                  marginTop: SPACING.md,
                }}
              >
                Welcome back
              </Text>
              <Text
                style={{
                  ...TYPO.subhead,
                  fontWeight: '400',
                  color: colors.textMuted,
                  marginTop: 2,
                }}
              >
                Check in before you start working.
              </Text>
            </>
          )}
        </View>

        <Image
          cachePolicy="memory-disk"
          source={checkin ? checkoutimg : checkinimg}
          style={{ width: 72, height: 72 }}
          contentFit="contain"
        />
      </View>

      {/* -------- stat row -------- */}
      {checkin && (
        <>
          <View
            style={{
              height: 1,
              backgroundColor: colors.dividerSubtle,
              marginVertical: SPACING.lg,
            }}
          />

          <View style={{ flexDirection: 'row' }}>
            {[
              {
                label: 'Break',
                value: formatMinutes((breakMinutes ?? 0) + liveBreakMinutes),
                tone: onBreak ? colors.warningText : colors.textPrimary,
              },
              { label: "Today's total", value: todayTotal || '--:--' },
              { label: 'Monthly total', value: monthlyTotal || '--:--' },
            ].map(stat => (
              <View key={stat.label} style={{ flex: 1 }}>
                <Text
                  numberOfLines={1}
                  style={{ ...TYPO.caption2, color: colors.textMuted }}
                >
                  {stat.label}
                </Text>
                <Text
                  style={{
                    ...TYPO.title3,
                    color: stat.tone || colors.textPrimary,
                    marginTop: 2,
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {stat.value}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}
    </Card>
  );
}

export default StatusCard;
