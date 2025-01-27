import { Inject, Injectable } from '@nestjs/common';
import { DB_CONST_REPOSITORY, dataSource } from 'src/config';
import { Repository } from 'typeorm';
import { Feed } from './feed.entity';
import { FeedFindOneVo } from './vo';
import { FEED_STATUS, ORDER_BY_VALUE, YN } from 'src/common';
import {
  FeedCreateDto,
  FeedListDto,
  FeedUpdateDto,
  FeedUpdateStatusDto,
} from './dto';
import { FeedImage } from '../feed-image/feed-image.entity';
import { PaginateResponseVo, generatePaginatedResponse } from 'src/core';
import { User } from '../user/user.entity';
import { FeedLike } from '../feed-like/feed-like.entity';
import { FeedBookmark } from '../feed-bookmark/feed-bookmark.entity';
import { MapperFeedTag } from '../mapper-feed-tag/mapper-feed-tag.entity';
import { Tag } from '../tag/tag.entity';

@Injectable()
export class FeedRepository {
  constructor(
    @Inject(DB_CONST_REPOSITORY.FEED)
    private readonly feedRepository: Repository<Feed>,
    @Inject(DB_CONST_REPOSITORY.USER)
    private readonly userRepository: Repository<User>,
    @Inject(DB_CONST_REPOSITORY.TAG)
    private readonly tagRepository: Repository<Tag>,
  ) {}

  // SELECTS

  /**
   * 전체 피드 목록
   * @returns
   */
  public async findAll(
    user: User,
    feedListDto?: FeedListDto,
    excludeUserIds?: number[],
  ): Promise<PaginateResponseVo<FeedFindOneVo>> {
    const feeds = this.feedRepository
      .createQueryBuilder('feed')
      .innerJoinAndSelect('feed.user', 'user')
      .leftJoinAndSelect('feed.tags', 'tags')
      .andWhere('feed.displayYn = :displayYn', { displayYn: YN.Y })
      .andWhere('feed.status = :status', { status: FEED_STATUS.ACTIVE });

    if (excludeUserIds.length > 0) {
      feeds.andWhere('user.id NOT IN (:...userId)', {
        userId: [...excludeUserIds],
      });
    }

    let filteredFeeds = await feeds
      .orderBy('feed.createdAt', ORDER_BY_VALUE.DESC)
      .getMany();

    if (feedListDto.tagName && feedListDto.tagName.length > 0) {
      filteredFeeds = filteredFeeds.filter((feed) =>
        feed.tags.some((tag) => tag.tagName === feedListDto.tagName),
      );
    }

    const offset = (feedListDto.page - 1) * feedListDto.limit;
    const paginatedFeeds = filteredFeeds.slice(
      offset,
      offset + feedListDto.limit,
    );

    const [items, totalCount] = [paginatedFeeds, filteredFeeds.length];

    for (const item of filteredFeeds) {
      await this.processFeedItem(item, user.id);
    }

    return generatePaginatedResponse(
      items,
      totalCount,
      feedListDto.page,
      feedListDto.limit,
    );
  }

  /**
   * 전체 피드 목록 (내가 작성한 피드 및 내가 팔로잉한 유저의 피드)
   * @returns
   */
  public async findAllByFollowing(
    user: User,
    feedListDto?: FeedListDto,
  ): Promise<PaginateResponseVo<FeedFindOneVo>> {
    const feeds = this.feedRepository
      .createQueryBuilder('feed')
      .innerJoinAndSelect('feed.user', 'user')
      .where('feed.userId IN (:...userId)', {
        userId: [...user.followingIds, user.id],
      })
      .andWhere('user.delYn = :delYn', { delYn: YN.N })
      .andWhere('feed.displayYn = :displayYn', { displayYn: YN.Y })
      .andWhere('feed.status = :status', { status: FEED_STATUS.ACTIVE })
      .orderBy('feed.createdAt', ORDER_BY_VALUE.DESC)
      .Paginate(feedListDto);

    const [items, totalCount] = await feeds.getManyAndCount();

    for (const item of items) {
      await this.processFeedItem(item, user.id);
    }

    return generatePaginatedResponse(
      items,
      totalCount,
      feedListDto.page,
      feedListDto.limit,
    );
  }

  /**
   * 유저별 피드 목록
   * @param userId
   * @returns
   */
  public async findAllByUser(
    userId: number,
    feedListDto?: FeedListDto,
  ): Promise<PaginateResponseVo<FeedFindOneVo>> {
    const feeds = this.feedRepository
      .createQueryBuilder('feed')
      .innerJoinAndSelect('feed.user', 'user')
      .where('feed.displayYn = :displayYn', { displayYn: YN.Y })
      .andWhere('feed.status = :status', { status: feedListDto.status })
      .andWhere('feed.userId = :userId', { userId: userId })
      .orderBy('feed.createdAt', ORDER_BY_VALUE.DESC)
      .Paginate(feedListDto);

    const [items, totalCount] = await feeds.getManyAndCount();

    for (const item of items) {
      await this.processFeedItem(item, userId);
    }

    return generatePaginatedResponse(
      items,
      totalCount,
      feedListDto.page,
      feedListDto.limit,
    );
  }

  /**
   * 유저별 북마크 피드 목록
   * @param userId
   * @returns
   */
  public async findAllByBookmark(
    user: User,
    feedListDto?: FeedListDto,
  ): Promise<PaginateResponseVo<FeedFindOneVo>> {
    const feeds = FeedBookmark.createQueryBuilder('feedBookmark')
      .innerJoinAndSelect('feedBookmark.feed', 'feed')
      .where('feed.displayYn = :displayYn', { displayYn: YN.Y })
      .andWhere('feed.status = :status', { status: FEED_STATUS.ACTIVE })
      .andWhere('feedBookmark.userId = :userId', { userId: user.id })
      .orderBy('feed.createdAt', ORDER_BY_VALUE.DESC)
      .Paginate(feedListDto);

    const [items, totalCount] = await feeds.getManyAndCount();

    for (const item of items) {
      await this.processFeedItem(item.feed, user.id);
    }

    return generatePaginatedResponse(
      items.map((item) => item.feed),
      totalCount,
      feedListDto.page,
      feedListDto.limit,
    );
  }

  /**
   * 피드 아이디로 찾기
   * @param ID
   * @returns FeedFindOneVo
   */
  public async findOneFeed(feedId: number): Promise<FeedFindOneVo> {
    const feed = await this.feedRepository
      .createQueryBuilder('feed')
      .innerJoinAndSelect('feed.user', 'user')
      .where('feed.id = :id', { id: feedId })
      .getOne();

    await this.processFeedItem(feed);

    return feed;
  }

  /**
   * 유저별 피드 상세
   * @param id
   * @returns FeedFindOneVo
   */
  public async findOneByUser(
    user: User,
    feedId: number,
  ): Promise<FeedFindOneVo> {
    const feed = await this.feedRepository
      .createQueryBuilder('feed')
      .innerJoinAndSelect('feed.user', 'user')
      .where('feed.id = :id', { id: feedId })
      .getOne();

    await this.processFeedItem(feed, user.id);

    return feed;
  }

  // INSERTS

  /**
   *  피드 생성
   * @param userId
   * @param feedCreateDto
   * @returns Feed
   */
  public async createFeed(
    userId: number,
    feedCreateDto: FeedCreateDto,
  ): Promise<Feed> {
    const feed = await dataSource.transaction(async (transaction) => {
      let newFeed = new Feed(feedCreateDto);
      newFeed.userId = userId;
      newFeed = await transaction.save(newFeed);
      // * feed image  생성
      if (feedCreateDto.feedImages && feedCreateDto.feedImages.length > 0) {
        await Promise.all(
          feedCreateDto.feedImages.map(async (image) => {
            let newImage = new FeedImage().set({
              feedId: newFeed.id,
              image: image.image,
              sortOrder: image.sortOrder,
            });
            newImage = await transaction.save(newImage);
          }),
        );
      }
      // * user feed count 증가
      let user = await this.userRepository.findOne({
        where: { id: userId },
      });

      user.feedCount++;
      user = await transaction.save(user);

      // * tagNames 배열 체크 후 FEED TAG MAPPER 테이블 생성
      if (feedCreateDto.tagNames && feedCreateDto.tagNames.length > 0) {
        await Promise.all(
          feedCreateDto.tagNames.map(async (tagName) => {
            // * Tag 테이블에서 해당 태그 검색
            let tag = await this.tagRepository.findOne({
              where: {
                tagName,
              },
            });

            // * 존재하는 태그 가 없을 경우 TAG 테이블에 새로 생성
            if (!tag) {
              tag = new Tag({
                tagName,
              });
              await transaction.save(tag);
            }

            // * FEED ID 와 TAG ID MAPPER 생성
            const newMapper = new MapperFeedTag({
              feedId: newFeed.id,
              tagId: tag.id,
            });
            await transaction.save(newMapper);
          }),
        );
      }

      return newFeed;
    });

    return feed;
  }

  /**
   * 피드 좋아요
   * @param userId
   * @param feedId
   */
  public async likeFeed(userId: number, feedId: number) {
    await dataSource.transaction(async (transaction) => {
      let newLike = new FeedLike().set({
        feedId,
        userId,
      });
      newLike = await transaction.save(newLike);

      let feed = await this.findOneFeed(feedId);
      feed.likeCount++;
      feed = await transaction.save(feed);
    });
  }

  /**
   * 피드 북마크
   * @param userId
   * @param feedId
   */
  public async bookmarkFeed(userId: number, feedId: number) {
    await dataSource.transaction(async (transaction) => {
      let newLike = new FeedBookmark().set({
        feedId,
        userId,
      });
      newLike = await transaction.save(newLike);
    });
  }

  // UPDATE

  /**
   *  피드 수정
   * @param feedId
   * @param feedUpdateDto
   * @returns Feed
   */
  public async updateFeed(
    feedId: number,
    feedUpdateDto: FeedUpdateDto,
  ): Promise<FeedFindOneVo> {
    const feed = await dataSource.transaction(async (transaction) => {
      let feed = await this.feedRepository.findOne({ where: { id: feedId } });

      // * 태그가 존재 하지 않는 경우
      if (feedUpdateDto.tagNames.length === 0) {
        await transaction
          .createQueryBuilder()
          .delete()
          .from(MapperFeedTag)
          .where('feedId = :feedId', { feedId: feedId })
          .execute();
      }

      // * tagNames 배열 체크 후 FEED TAG MAPPER 테이블 생성
      if (feedUpdateDto.tagNames && feedUpdateDto.tagNames.length > 0) {
        await Promise.all(
          feedUpdateDto.tagNames.map(async (tagName) => {
            // * Tag 테이블에서 해당 태그 검색
            let tag = await this.tagRepository.findOne({
              where: {
                tagName,
              },
            });

            //* 존재하는 태그 가 없을 경우 TAG 테이블에 새로 생성
            if (!tag) {
              tag = new Tag({
                tagName,
              });
              tag = await transaction.save(tag);
            }

            //* MAPPER가 없을 경우 FEED ID 와 TAG ID MAPPER 생성
            const mapper = await MapperFeedTag.findOne({
              where: {
                tagId: tag.id,
                feedId: feedId,
              },
            });

            if (!mapper) {
              const newMapper = new MapperFeedTag({
                feedId: feed.id,
                tagId: tag.id,
              });
              await transaction.save(newMapper);
            }

            const feedTags = (await this.findOneFeed(feedId)).tags;

            // * 기존 태그가 삭제된 경우 FEED ID 와 TAG ID MAPPER 삭제
            const prevTags = new Set(feedTags.map((tag) => tag.tagName));
            const currentTags = new Set(feedUpdateDto.tagNames);
            const deletedTags = [...prevTags].filter(
              (tag) => !currentTags.has(tag),
            );

            if (deletedTags.length > 0) {
              await Promise.all(
                deletedTags.map(async (tagName) => {
                  const deleteTag = await this.tagRepository.findOne({
                    where: {
                      tagName,
                    },
                  });

                  if (deleteTag && deleteTag.id) {
                    await transaction
                      .createQueryBuilder()
                      .delete()
                      .from(MapperFeedTag)
                      .where('feedId = :feedId', { feedId })
                      .andWhere('tagId = :tagId', {
                        tagId: deleteTag.id,
                      })
                      .execute();
                  }
                }),
              );
            }
          }),
        );
      }

      feed.description = feedUpdateDto.description;
      feed.updatedAt = new Date();
      feed = await transaction.save(feed);
      return feed;
    });

    return feed;
  }

  /**
   *  피드 상태 수정
   * @param feedId
   * @param feedUpdateDto
   * @returns Feed
   */
  public async updateFeedStatus(
    feedId: number,
    feedUpdateStatusDto: FeedUpdateStatusDto,
  ): Promise<FeedFindOneVo> {
    const feed = await dataSource.transaction(async (transaction) => {
      let feed = await this.findOneFeed(feedId);
      feed.status = feedUpdateStatusDto.status;
      feed = await transaction.save(feed);

      let user = await this.userRepository.findOne({
        where: {
          id: feed.userId,
        },
      });
      if (feed.status === FEED_STATUS.ACTIVE) {
        user.feedCount++;
      } else {
        user.feedCount--;
      }
      user = await transaction.save(user);

      return feed;
    });

    return feed;
  }

  /**
   *  피드 좋아요 수 노출 상태 수정
   * @param feedId
   * @param feedUpdateDto
   * @returns Feed
   */
  public async updateShowLikeCount(
    feedId: number,
    feedUpdateStatusDto: FeedUpdateStatusDto,
  ): Promise<FeedFindOneVo> {
    const feed = await dataSource.transaction(async (transaction) => {
      let feed = await this.findOneFeed(feedId);
      feed.showLikeCountYn = feedUpdateStatusDto.showLikeCountYn;
      feed = await transaction.save(feed);
      return feed;
    });

    return feed;
  }

  // DELETE

  /**
   *  피드 삭제 (FEED STATUS => DELETED)
   * @param feedId
   * @returns Feed
   */
  public async deleteFeed(
    userId: number,
    feedId: number,
  ): Promise<FeedFindOneVo> {
    return await dataSource.transaction(async (transaction) => {
      let feed = await this.feedRepository.findOne({
        where: {
          id: feedId,
        },
      });
      feed.status = FEED_STATUS.DELETED;
      feed = await transaction.save(feed);

      // * USER FEED COUNT 감소
      let user = await this.userRepository.findOne({
        where: { id: userId },
      });

      user.feedCount--;
      user = await transaction.save(user);

      return feed;
    });
  }

  /**
   * 피드 영구 삭제
   * @param userId
   * @param feedId
   */
  public async hardDeleteFeed(userId: number, feedId: number) {
    await dataSource.transaction(async (transaction) => {
      // * FEED IMAGE 삭제
      await transaction
        .createQueryBuilder()
        .delete()
        .from(FeedImage)
        .where('feedId = :feedId', { feedId })
        .execute();

      // * FEED LIKE 삭제
      await transaction
        .createQueryBuilder()
        .delete()
        .from(FeedLike)
        .where('feedId = :feedId', {
          feedId,
        })
        .execute();

      // * FEED BOOKMARK 삭제
      await transaction
        .createQueryBuilder()
        .delete()
        .from(FeedBookmark)
        .where('feedId = :feedId', {
          feedId,
        })
        .execute();

      // * FEED 삭제
      await transaction
        .createQueryBuilder()
        .delete()
        .from(Feed)
        .where('id = :id', { id: feedId })
        .execute();

      // * USER FEED COUNT 감소
      let user = await this.userRepository.findOne({
        where: { id: userId },
      });

      user.feedCount--;
      user = await transaction.save(user);
    });
  }

  /**
   *  피드 이미지 삭제
   * @param feedId
   * @returns Feed
   */
  public async deleteFeedImage(feedId: number, sortOrder: number) {
    await dataSource.transaction(async (transaction) => {
      await transaction
        .createQueryBuilder()
        .delete()
        .from(FeedImage)
        .where('feedId = :feedId', { feedId })
        .andWhere('sortOrder = :sortOrder', { sortOrder })
        .execute();
    });
  }

  /**
   *  피드 좋아요 해제
   * @param userId
   * @param feedId
   */
  public async deleteLikeFeed(userId: number, feedId: number) {
    await dataSource.transaction(async (transaction) => {
      await transaction
        .createQueryBuilder()
        .delete()
        .from(FeedLike)
        .where('feedId = :feedId', { feedId: feedId })
        .andWhere('userId = :userId', { userId: userId })
        .execute();

      let feed = await this.findOneFeed(feedId);
      feed.likeCount--;
      feed = await transaction.save(feed);
    });
  }

  /**
   * 피드 북마크 해제
   * @param userId
   * @param feedId
   */
  public async deleteBookmarkFeed(userId: number, feedId: number) {
    await dataSource.transaction(async (transaction) => {
      await transaction
        .createQueryBuilder()
        .delete()
        .from(FeedBookmark)
        .where('feedId = :feedId', { feedId: feedId })
        .andWhere('userId = :userId', { userId: userId })
        .execute();
    });
  }

  private async processFeedItem(
    item: Feed,
    userId?: number,
  ): Promise<FeedFindOneVo> {
    item.feedImages = await this.__get_feed_images(item.id);
    item.tags = await this.__get_feed_tags(item.id);

    // * 좋아요 체크 여부
    if (userId) {
      const isLiked = await this.__get_feed_like_by_user(userId, item.id);
      item.likedYn = isLiked;
    }

    // * 북마크 체크 여부
    if (userId) {
      const isBookmarked = await this.__get_feed_bookmark_by_user(
        userId,
        item.id,
      );
      item.bookmarkedYn = isBookmarked;
    }

    return item;
  }

  private async __get_feed_tags(feedId: number) {
    const feedTags = await MapperFeedTag.createQueryBuilder('mapperFeedTag')
      .where('mapperFeedTag.feedId = :feedId', { feedId })
      .getMany();
    const tagIds = feedTags.map((tag) => tag.tagId);
    const tagNames = await Promise.all(
      tagIds.map(async (tagId) => {
        const result = await this.tagRepository.findOne({
          where: { id: tagId },
        });
        return result;
      }),
    );
    return tagNames;
  }

  private async __get_feed_images(feedId: number) {
    const feedImages = await FeedImage.createQueryBuilder('feedImage')
      .where('feedImage.feedId = :feedId', { feedId })
      .getMany();
    return feedImages;
  }

  private async __get_feed_like_by_user(
    userId: number,
    feedId: number,
  ): Promise<boolean> {
    const feedLike = await FeedLike.createQueryBuilder('feedLike')
      .where('feedLike.feedId = :feedId', { feedId })
      .andWhere('feedLike.userId = :userId', {
        userId,
      })
      .getExists();

    return feedLike === true ? true : false;
  }

  private async __get_feed_bookmark_by_user(
    userId: number,
    feedId: number,
  ): Promise<boolean> {
    const feedBookmark = await FeedBookmark.createQueryBuilder('feedBookmark')
      .where('feedBookmark.feedId = :feedId', { feedId })
      .andWhere('feedBookmark.userId = :userId', {
        userId,
      })
      .getExists();
    return feedBookmark === true ? true : false;
  }
}
