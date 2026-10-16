import type { Me } from '@portl/contracts';
import { router } from 'expo-router';
import { Badge, Card, Copy, Row, Title } from '../../components/ui';
import {
  ActionRow,
  ActionTile,
  SectionHeading,
} from '../../components/task-ui';
import type { CommunityContext } from '../../components/navigation/model';
import { VisitorQueue } from '../gate/visitor-queue';

export function CommunityDashboard({
  context,
  userId,
}: {
  context: CommunityContext;
  userId: Me['user']['id'];
}) {
  const { member, role } = context;
  const societyId = member.society.id;
  return (
    <>
      <Title>
        {role === 'GUARD'
          ? 'Ready for the next arrival.'
          : role === 'ADMIN'
            ? 'Your society, at a glance.'
            : 'Welcome home.'}
      </Title>
      <Copy>
        {role === 'RESIDENT'
          ? 'A little closer to your community.'
          : role === 'GUARD'
            ? 'Register, verify and keep the gate moving.'
            : 'Keep your community running smoothly.'}
      </Copy>
      {member.society.isDemo && <Badge>Demo society</Badge>}
      {role === 'RESIDENT' ? (
        <>
          <VisitorQueue
            key={`${userId}:${societyId}`}
            userId={userId}
            societyId={societyId}
            view="RESIDENT"
            presentation="summary"
          />
          <SectionHeading>Make room for your people</SectionHeading>
          <Row>
            <ActionTile
              icon="user-plus"
              title="Invite a guest"
              detail="Create a single-visit pass"
              onPress={() =>
                router.push({
                  pathname: '/create-guest-pass',
                  params: { societyId },
                })
              }
            />
            <ActionTile
              icon="credit-card"
              title="Guest passes"
              detail="View upcoming and past visits"
              onPress={() =>
                router.push({
                  pathname: '/guest-passes',
                  params: { societyId, view: role },
                })
              }
            />
          </Row>
          <SectionHeading>Around your society</SectionHeading>
          <Card>
            <ActionRow
              icon="file-text"
              title="Society notices"
              detail="Updates from your society office"
              onPress={() =>
                router.push({
                  pathname: '/notices',
                  params: { societyId, view: role },
                })
              }
            />
            <ActionRow
              icon="users"
              title="Community directory"
              detail="Staff and services, close at hand"
              onPress={() =>
                router.push({ pathname: '/directory', params: { societyId } })
              }
            />
            <ActionRow
              icon="clock"
              title="Visitor requests & history"
              detail="Waiting, approved and completed visits"
              onPress={() =>
                router.push({
                  pathname: '/visitors',
                  params: { societyId, view: role },
                })
              }
            />
          </Card>
        </>
      ) : (
        <Card>
          {role === 'GUARD' ? (
            <>
              <ActionRow
                icon="shield"
                title="Open guard dashboard"
                detail="Arrivals, approvals and movement"
                onPress={() =>
                  router.push({
                    pathname: '/visitors',
                    params: { societyId, view: role },
                  })
                }
              />
              <ActionRow
                icon="check-circle"
                title="Verify guest pass"
                detail="Check a pre-approved guest at the gate"
                onPress={() =>
                  router.push({
                    pathname: '/verify-guest-pass',
                    params: { societyId },
                  })
                }
              />
            </>
          ) : (
            <>
              <ActionRow
                icon="grid"
                title="Society overview"
                detail="Residents, towers and gate operations"
                onPress={() =>
                  router.push({
                    pathname: '/society-operations',
                    params: { societyId },
                  })
                }
              />
              <ActionRow
                icon="user-plus"
                title="Manage resident onboarding"
                detail="Applications, invitations and gate access"
                onPress={() =>
                  router.push({ pathname: '/admin', params: { societyId } })
                }
              />
              <ActionRow
                icon="file-text"
                title="Manage society notices"
                detail="Draft, publish and archive"
                onPress={() =>
                  router.push({
                    pathname: '/notices',
                    params: { societyId, view: role },
                  })
                }
              />
              <ActionRow
                icon="clock"
                title="View society visitors"
                detail="Current movement and visit history"
                onPress={() =>
                  router.push({
                    pathname: '/visitors',
                    params: { societyId, view: role },
                  })
                }
              />
            </>
          )}
        </Card>
      )}
    </>
  );
}
