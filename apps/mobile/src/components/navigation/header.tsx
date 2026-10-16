import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Icon } from '../icon';
import { colors } from '../theme';
import { useCommunityNavigation } from './context';
import { roleLabels } from './model';

export function AppHeader({ back = false }: { back?: boolean }) {
  const nav = useCommunityNavigation();
  const [choosing, setChoosing] = useState(false);
  const context = nav?.visible ? nav.context : null;
  const canChoose = !!nav?.available && !!nav.memberships.length;
  return (
    <>
      <View style={s.header}>
        {back && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={s.icon}
            onPress={() =>
              router.canGoBack() ? router.back() : router.replace('/')
            }
          >
            <Icon name="chevron-left" />
          </Pressable>
        )}
        {!back && canChoose ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose society and role"
            onPress={() => setChoosing(true)}
            style={s.context}
          >
            <View style={s.contextText}>
              <Text style={s.name}>
                {context?.member.society.name ?? 'Choose your community'}
              </Text>
              <Text style={s.detail}>
                {context
                  ? `${roleLabels[context.role]}${context.role === 'RESIDENT' && context.member.flats.length ? (context.member.flats.length === 1 ? ` · ${context.member.flats[0]!.tower}/${context.member.flats[0]!.label}` : ` · ${context.member.flats.length} homes`) : ''}`
                  : 'Your societies and authorized roles'}
              </Text>
            </View>
            <Icon name="chevron-down" size={16} />
          </Pressable>
        ) : (
          <Text style={s.brand}>
            portl<Text style={s.dot}>.</Text>
          </Text>
        )}
        {!back && context && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            style={s.icon}
            onPress={() => router.push('/notifications')}
          >
            <Icon name="bell" />
          </Pressable>
        )}
        {back && context && (
          <Text style={s.backContext}>{context.member.society.name}</Text>
        )}
      </View>
      <Modal
        visible={choosing}
        transparent
        animationType="fade"
        onRequestClose={() => setChoosing(false)}
      >
        <View style={s.backdrop}>
          <SafeAreaView
            edges={['bottom']}
            style={s.sheet}
            accessibilityViewIsModal
          >
            <Text accessibilityRole="header" style={s.title}>
              Your communities
            </Text>
            <Text style={s.detail}>Choose an existing society and role.</Text>
            <ScrollView contentContainerStyle={s.options}>
              {nav?.memberships.flatMap((member) =>
                member.roles.map((role) => (
                  <Pressable
                    key={`${member.society.id}:${role}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${member.society.name}, ${roleLabels[role]}`}
                    onPress={() => {
                      setChoosing(false);
                      nav.select({ societyId: member.society.id, role });
                    }}
                    style={s.option}
                  >
                    <Icon name={role === 'GUARD' ? 'shield' : 'home'} />
                    <View style={s.contextText}>
                      <Text style={s.name}>{member.society.name}</Text>
                      <Text style={s.detail}>{roleLabels[role]}</Text>
                    </View>
                    <Icon name="chevron-right" size={18} />
                  </Pressable>
                )),
              )}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setChoosing(false);
                router.push('/community');
              }}
              style={s.close}
            >
              <Text style={s.name}>Join another society</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setChoosing(false)}
              style={s.close}
            >
              <Text style={s.detail}>Close</Text>
            </Pressable>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}
const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 60,
    marginBottom: 8,
  },
  brand: {
    flex: 1,
    color: colors.ink,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -1.5,
  },
  dot: { color: colors.accent },
  context: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 52,
  },
  contextText: { flex: 1, gap: 4 },
  name: { color: colors.ink, fontSize: 15, fontWeight: '600', lineHeight: 21 },
  detail: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  icon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: 24,
  },
  backContext: {
    color: colors.muted,
    fontSize: 12,
    flex: 1,
    textAlign: 'right',
  },
  backdrop: {
    flex: 1,
    backgroundColor: '#13271E66',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    maxHeight: '85%',
    padding: 24,
    gap: 12,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  title: { color: colors.ink, fontSize: 23, fontWeight: '600' },
  options: { gap: 4 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  close: { alignItems: 'center', justifyContent: 'center', minHeight: 48 },
});
